import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / 'lib/model-worker-capture.py'
spec = importlib.util.spec_from_file_location('model_capture', PATH)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


class CaptureTests(unittest.TestCase):
    def run_capture(self, events=b'{}\n', stderr=b'', final=b'answer', *, writer=True,
                    proven=True, cancelled=False, retain=False):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            done = threading.Event()
            def produce():
                try:
                    for fd, payload in ((ew, events), (dw, stderr)):
                        try:
                            for offset in range(0, len(payload), 8192):
                                os.write(fd, payload[offset:offset + 8192])
                        except BrokenPipeError:
                            pass
                        finally:
                            os.close(fd)
                    if writer:
                        try:
                            fd = os.open(sink.path, os.O_WRONLY | os.O_NONBLOCK)
                            for offset in range(0, len(final), 8192):
                                # FIFO is nonblocking only on reader; keep writer blocking for bounded fixture.
                                os.set_blocking(fd, True)
                                os.write(fd, final[offset:offset + 8192])
                            os.close(fd)
                        except (BrokenPipeError, FileNotFoundError, OSError):
                            pass
                finally:
                    done.set()
            thread = threading.Thread(target=produce)
            thread.start()
            result = m.collect(er, dr, sink, deadline=time.monotonic() + 1,
                terminal=lambda: m.Terminal(done.is_set(), 0 if done.is_set() else None, proven),
                cancelled=lambda: cancelled)
            thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertFalse(Path(sink.path).exists())
            return result

    def test_exact_bytes_and_false_authority(self):
        result = self.run_capture(events='{"text":"é"}\n'.encode(), final=b'exact\x00bytes')
        self.assertEqual(result.status, 'captured')
        self.assertEqual(result.final, b'exact\x00bytes')
        self.assertEqual(result.events, '{"text":"é"}\n'.encode())
        self.assertFalse(result.receipt()['replay_authorized'])
        self.assertFalse(result.receipt()['resource_contained'])

    def test_missing_final_writer_is_held(self):
        result = self.run_capture(writer=False, proven=False)
        self.assertEqual(result.reason, 'final_write_unproven')
        self.assertEqual(result.events, b'')

    def test_explicit_empty_write_contract(self):
        self.assertEqual(self.run_capture(final=b'').status, 'captured')

    def test_partial_event_eof(self):
        self.assertEqual(self.run_capture(events=b'{}').reason, 'partial_event_frame')

    def test_frame_boundary(self):
        self.assertEqual(self.run_capture(events=b'x' * m.FRAME + b'\n').status, 'captured')
        self.assertEqual(self.run_capture(events=b'x' * (m.FRAME + 1) + b'\n').reason, 'event_frame_overflow')

    def test_each_stream_and_aggregate_bounds(self):
        for field in ('stderr', 'final'):
            result = self.run_capture(**{field: b'x' * (m.CAPS[field] + 1)})
            self.assertEqual(result.reason, 'capture_overflow')
            self.assertLessEqual(dict(result.counts)[field], m.CAPS[field])
        frames = b'{}\n' * (m.CAPS['events'] // 3 + 1)
        result = self.run_capture(events=frames)
        self.assertEqual(result.reason, 'capture_overflow')
        self.assertLessEqual(sum(dict(result.counts).values()), m.AGGREGATE)
        result = self.run_capture(events=b'{}\n' * (m.CAPS['events'] // 3), stderr=b'x' * m.CAPS['stderr'], final=b'x' * 100)
        self.assertEqual(result.reason, 'capture_overflow')
        self.assertLessEqual(sum(dict(result.counts).values()), m.AGGREGATE)

    def test_cancel(self):
        self.assertEqual(self.run_capture(cancelled=True).reason, 'cancelled')

    def test_keeper_prevents_early_eof_and_finite_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            start = time.monotonic()
            result = m.collect(er, dr, sink, deadline=start + .040, terminal=lambda: m.Terminal(False))
            self.assertEqual(result.reason, 'deadline')
            self.assertGreaterEqual(time.monotonic() - start, .030)
            self.assertLess(time.monotonic() - start, .300)

    def test_retained_pipe_drain_is_finite(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            start = time.monotonic()
            try:
                result = m.collect(er, dr, sink, deadline=start + 1, terminal=lambda: m.Terminal(True, 0, True))
                self.assertEqual(result.reason, 'drain_deadline')
                self.assertLess(time.monotonic() - start, .600)
            finally:
                os.close(ew); os.close(dw)

    def test_callback_lateness_and_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            def late():
                time.sleep(.030)
                return m.Terminal(True, 0, True)
            result = m.collect(er, dr, sink, deadline=time.monotonic() + .010, terminal=late)
            self.assertEqual(result.reason, 'deadline')
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            result = m.collect(er, dr, sink, deadline=time.monotonic() + 1, terminal=lambda: None)
            self.assertEqual(result.reason, 'observation_unknown')

    def test_delayed_final_writer_does_not_finalize_early(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            done = threading.Event()
            def writer():
                time.sleep(.030)
                fd = os.open(sink.path, os.O_WRONLY)
                os.write(fd, b'delayed-final')
                os.close(fd)
                done.set()
            thread = threading.Thread(target=writer)
            thread.start()
            result = m.collect(er, dr, sink, deadline=time.monotonic() + 1,
                terminal=lambda: m.Terminal(done.is_set(), 0 if done.is_set() else None, done.is_set()))
            thread.join(1)
            self.assertFalse(thread.is_alive())
            self.assertEqual(result.final, b'delayed-final')
            self.assertEqual(result.status, 'captured')

    def test_close_failure_holds_and_discards(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            real_close = os.close
            def fail(fd):
                real_close(fd)
                if fd == er:
                    raise OSError('synthetic private diagnostic')
            with patch.object(m.os, 'close', fail):
                result = m.collect(er, dr, sink, deadline=time.monotonic() + 1,
                    terminal=lambda: m.Terminal(True, 0, True))
            self.assertEqual(result.reason, 'descriptor_cleanup_uncertain')
            self.assertEqual(result.status, 'held')
            self.assertEqual(result.events, b'')
            self.assertNotIn('synthetic', str(result.receipt()))

    def test_invalid_deadline_closes_transferred_readers(self):
        for duplicate in (False, True):
            with tempfile.TemporaryDirectory() as directory:
                sink = m.FinalSink(Path(directory).resolve())
                er, ew = os.pipe(); dr, dw = os.pipe()
                if duplicate:
                    os.close(dr); dr = er
                os.close(ew); os.close(dw)
                result = m.collect(er, dr, sink, deadline=time.monotonic() - 1,
                    terminal=lambda: m.Terminal(False))
                self.assertEqual(result.status, 'held')
                for fd in set((er, dr)):
                    with self.assertRaises(OSError):
                        os.fstat(fd)
                self.assertFalse(Path(sink.path).exists())

    def test_replacement_during_discovery_preserves_original_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            replacement, replacement_writer = os.pipe()
            os.close(ew); os.close(dw)
            real_identity = m.identity
            replaced = [False]
            def swapping(fd):
                key = real_identity(fd)
                if fd == sink.reader and not replaced[0]:
                    os.dup2(replacement, er)
                    replaced[0] = True
                return key
            try:
                with patch.object(m, 'identity', swapping):
                    result = m.collect(er, dr, sink, deadline=time.monotonic() + 1,
                        terminal=lambda: m.Terminal(True, 0, True))
                self.assertEqual(result.status, 'held')
                self.assertEqual(result.events, b'')
                self.assertEqual(real_identity(er), real_identity(replacement))
                self.assertTrue(os.get_blocking(er))
                with self.assertRaises(OSError):
                    os.fstat(dr)
                self.assertFalse(Path(sink.path).exists())
            finally:
                os.close(er); os.close(replacement); os.close(replacement_writer)

    def test_invalid_descriptor_does_not_leak_other_owned_reader(self):
        for first_invalid in (True, False):
            with tempfile.TemporaryDirectory() as directory:
                sink = m.FinalSink(Path(directory).resolve())
                reader, writer = os.pipe(); os.close(writer)
                args = (-1, reader) if first_invalid else (reader, -1)
                result = m.collect(*args, sink, deadline=time.monotonic() + 1,
                    terminal=lambda: m.Terminal(False))
                self.assertEqual(result.reason, 'invalid_descriptors')
                with self.assertRaises(OSError):
                    os.fstat(reader)
                self.assertFalse(Path(sink.path).exists())
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            reader, writer = os.pipe(); os.close(writer)
            result = m.collect(reader, reader, sink, deadline=time.monotonic() + 1,
                terminal=lambda: m.Terminal(False))
            self.assertEqual(result.reason, 'invalid_descriptors')
            with self.assertRaises(OSError):
                os.fstat(reader)

    def test_selector_close_failure_does_not_skip_other_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            factory = m.selectors.DefaultSelector
            selector = factory()
            real_close = selector.close
            def fail():
                real_close()
                raise OSError('private')
            selector.close = fail
            with patch.object(m.selectors, 'DefaultSelector', lambda: selector):
                result = m.collect(er, dr, sink, deadline=time.monotonic() + 1,
                    terminal=lambda: m.Terminal(True, 0, True))
            self.assertEqual(result.reason, 'descriptor_cleanup_uncertain')
            for fd in (er, dr):
                with self.assertRaises(OSError):
                    os.fstat(fd)
            self.assertFalse(Path(sink.path).exists())

    def test_late_cleanup_cannot_return_captured(self):
        with tempfile.TemporaryDirectory() as directory:
            sink = m.FinalSink(Path(directory).resolve())
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            now = [time.monotonic()]
            real_close = sink.close
            def late_close():
                okay = real_close()
                now[0] += 2
                return okay
            sink.close = late_close
            result = m.collect(er, dr, sink, deadline=now[0] + 1,
                clock=lambda: now[0], terminal=lambda: m.Terminal(True, 0, True))
            self.assertEqual(result.status, 'held')
            self.assertEqual(result.reason, 'deadline')
            self.assertEqual(result.final, b'')

    def test_directory_path_replacement_holds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            parent = root / 'owner'; parent.mkdir(mode=0o700)
            sink = m.FinalSink(parent)
            parent.rename(root / 'old')
            parent.mkdir(mode=0o700)
            er, ew = os.pipe(); dr, dw = os.pipe()
            os.close(ew); os.close(dw)
            result = m.collect(er, dr, sink, deadline=time.monotonic() + 1,
                terminal=lambda: m.Terminal(True, 0, True))
            self.assertEqual(result.status, 'held')
            self.assertEqual(result.reason, 'descriptor_cleanup_uncertain')
            self.assertEqual(list((root / 'old').iterdir()), [])
            self.assertEqual(list(parent.iterdir()), [])

    def test_creation_reader_open_failure_removes_exact_fifo(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            real_open = os.open
            def fail(path, flags, *args, **kwargs):
                if kwargs.get('dir_fd') is not None and flags & os.O_ACCMODE == os.O_RDONLY:
                    raise OSError('fixture')
                return real_open(path, flags, *args, **kwargs)
            with patch.object(m.os, 'open', fail):
                with self.assertRaises(m.Held):
                    m.FinalSink(root)
            self.assertEqual(list(root.iterdir()), [])

    def test_unsafe_directory_and_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            link = root / 'link'; link.symlink_to(root, target_is_directory=True)
            with self.assertRaises(m.Held):
                m.FinalSink(link)
            sink = m.FinalSink(root)
            Path(sink.path).unlink(); Path(sink.path).write_bytes(b'replacement')
            self.assertFalse(sink.close())
            self.assertEqual(Path(sink.path).read_bytes(), b'replacement')

if __name__ == '__main__':
    unittest.main()
