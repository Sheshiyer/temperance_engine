import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).parents[1]/'lib'/'rss-pressure-diagnostic.py'
spec = importlib.util.spec_from_file_location('rss_diagnostic_fixture', SOURCE)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


def row(pid=2, rss=10, state='live'):
    return {'pid':pid,'uid':77,'parent_pid':0,'birth':'darwin:1:0','state':state,'rss_bytes':rss}


class Clock:
    def __init__(self):self.value=1_000_000
    def __call__(self):self.value+=1;return self.value


class Fixtures(unittest.TestCase):
    def deps(self, rows, pressures=('normal','host_pressure_elevated'), clock=None, read_action=None):
        clock = clock or Clock()
        self.usage_calls = self.capture_calls = 0
        pressure = iter(pressures)
        class Observer:
            def __init__(inner, deadline, *, clock):pass
            def pressure(inner):return next(pressure)
            def usage(inner, *args):self.usage_calls+=1;raise AssertionError()
        class Capture:
            def __init__(inner,uid,deadline,*,clock):self.assertEqual(uid,77)
            def read(inner):
                self.capture_calls+=1
                if read_action:read_action()
                return rows
        def validate(v):
            if type(v) is not dict or set(v)!=set(row()):raise owner.Held('row_invalid')
            for key,low,high in (('pid',2,2**31-1),('uid',0,2**32-1),('parent_pid',0,2**31-1),('rss_bytes',0,2**64-1)):
                if type(v[key]) is not int or not low<=v[key]<=high:raise owner.Held('row_invalid')
            if type(v['birth']) is not str or len(v['birth'])>128 or v['state'] not in ('live','stopped','zombie'):raise owner.Held('row_invalid')
        return (types.SimpleNamespace(Backend=Observer,Held=owner.Held),types.SimpleNamespace(Capture=Capture,row=validate))
    def run_point(self,rows,**kwargs):
        clock=kwargs.pop('clock',Clock())
        return owner.diagnose(_clock=clock,_uid=lambda:77,_dependencies=self.deps(rows,clock=clock,**kwargs))
    def test_closed_redacted_aggregate_with_exact_decimal_uint64_sum(self):
        result=self.run_point({2:row(rss=2**64-1),3:row(3,5,'stopped'),4:row(4,0,'zombie')})
        self.assertEqual(result['status'],'measured');self.assertEqual(result['rss_sum_bytes'],str(2**64+4));self.assertEqual(result['rss_max_bytes'],str(2**64-1));self.assertEqual(result['metadata_rows'],3)
        self.assertEqual((result['live_rows'],result['stopped_rows'],result['zombie_rows']),(1,1,1));self.assertEqual(self.usage_calls,0)
        serialized=json.dumps(result)
        for private in ('darwin:1:0','parent_pid','"uid"','"pid"','argv','account','provider'):self.assertNotIn(private,serialized)
        for flag in ('execution_authorized','capacity_authorization','cleanup_verified','causal_attribution','sustained_acceptance','native_worker_acceptance'):self.assertIs(result[flag],False)
    def test_4096_boundary_and_oversized_map_hold_without_partial_totals(self):
        result=self.run_point({n:row(n) for n in range(2,4098)})
        self.assertEqual(result['metadata_rows'],4096)
        held=self.run_point({n:row(n) for n in range(2,4099)})
        self.assertEqual(held['reason'],'snapshot_bound');self.assertIsNone(held['rss_sum_bytes'])
    def test_closed_scalar_row_failures_no_unsafe_outer_subclass_reads(self):
        class Unsafe(dict):
            def items(self):raise AssertionError('private-detail')
        for rows in [Unsafe({2:row()}),{}, {2:dict(row(),extra='private')},{True:row()}, {2:row(3)}, {2:dict(row(),uid=78)}, {2:dict(row(),rss_bytes=True)}, {2:dict(row(),rss_bytes=2**64)}, {2:dict(row(),state=object())}]:
            result=self.run_point(rows);self.assertEqual(result['status'],'held');self.assertIsNone(result['rss_sum_bytes']);self.assertNotIn('private',json.dumps(result))
    def test_unknown_pressure_blocks_capture_and_postfailure_discards_totals(self):
        for pressures,expected in [(('host_pressure_unavailable',),0),(('normal','host_pressure_unavailable'),1),((None,),0)]:
            result=self.run_point({2:row()},pressures=pressures);self.assertEqual(result['reason'],'pressure_unavailable');self.assertEqual(self.capture_calls,expected);self.assertIsNone(result['rss_sum_bytes'])
    def test_shared_deadline_late_callback_clock_regression_and_error_redaction(self):
        clock=Clock()
        def late():clock.value+=owner.MAX_NS
        result=self.run_point({2:row()},clock=clock,read_action=late);self.assertEqual(result['reason'],'deadline');self.assertIsNone(result['rss_sum_bytes'])
        def fail():raise RuntimeError('private-exception-content')
        result=self.run_point({2:row()},read_action=fail);self.assertEqual(result['reason'],'diagnostic_unavailable');self.assertNotIn('private-exception',json.dumps(result))
        ticks=iter([100,99]);result=owner.diagnose(_clock=lambda:next(ticks),_uid=lambda:77,_dependencies=self.deps({2:row()}));self.assertEqual(result['reason'],'clock_unavailable')
    def test_import_is_pure_and_default_cli_no_arguments_does_not_query(self):
        with patch.object(owner,'diagnose',side_effect=AssertionError('queried')),patch.object(owner.sys,'argv',['helper']),contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(owner.main(),2)
        self.assertEqual(json.loads(output.getvalue())['reason'],'manual_invocation_required')
    def test_detached_pinned_loader_executes_two_sources_without_second_loader_read(self):
        reads=[]
        def read(path,timer):reads.append(path.name);return owner.read_source(path,timer)
        with patch('importlib.util.spec_from_file_location',side_effect=AssertionError('second unbounded read')):
            native,inventory=owner.load_sources(owner.Timer(Clock()),_reader=read)
        self.assertIs(inventory.native,native);self.assertEqual(reads,list(owner.PINS));self.assertEqual(inventory.MAX_ROWS,4096)
        # Existing row API validates actual RSS field without invoking native queries.
        inventory.row(row())
        util=inventory.__dict__['importlib'].util
        for name,path in [('arbitrary',SOURCE),('worker_native_inventory_basis',SOURCE)]:
            with self.assertRaises(owner.Held):util.spec_from_file_location(name,path)
        with self.assertRaises(owner.Held):util.module_from_spec(object())
    def test_source_hash_drift_and_oversize_are_held_before_code_execution(self):
        for payload,reason in [(b'raise AssertionError("private")','source_drift'),(b'x'*65537,'source_unavailable')]:
            with self.assertRaises(owner.Held) as error:owner.load_sources(owner.Timer(Clock()),_reader=lambda *args:payload)
            self.assertEqual(error.exception.args,(reason,))
    def test_source_descriptor_size_symlink_fifo_and_close_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source';path.write_bytes(b'x'*65537)
            with patch.object(owner.os,'open',side_effect=AssertionError('allocated/opened')):
                with self.assertRaises(owner.Held):owner.read_source(path,owner.Timer(Clock()))
            path.unlink();path.symlink_to(SOURCE)
            with self.assertRaises(owner.Held):owner.read_source(path,owner.Timer(Clock()))
            path.unlink();os.mkfifo(path)
            with self.assertRaises(owner.Held):owner.read_source(path,owner.Timer(Clock()))
            path.unlink();path.write_bytes(b'ok');real=owner.os.close
            def close(fd):real(fd);raise RuntimeError('private-close')
            with patch.object(owner.os,'close',side_effect=close):
                with self.assertRaises(owner.Held) as error:owner.read_source(path,owner.Timer(Clock()))
            self.assertEqual(error.exception.args,('source_unavailable',))

    def test_source_short_reads_and_growth_truncation_same_size_path_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source'
            real_read=owner.os.read
            path.write_bytes(b'abcdef')
            reads=[]
            def short(fd,size):reads.append(size);return real_read(fd,min(size,2))
            with patch.object(owner.os,'read',side_effect=short):self.assertEqual(owner.read_source(path,owner.Timer(Clock())),b'abcdef')
            self.assertGreater(len(reads),2);self.assertTrue(all(n<=16384 for n in reads))
            for mode in ('growth','truncation','same-size','replacement'):
                path.write_bytes(b'abcdef');changed=False
                def drift(fd,size):
                    nonlocal changed
                    data=real_read(fd,min(size,3))
                    if not changed:
                        changed=True
                        if mode=='growth':
                            with path.open('ab') as output:output.write(b'g')
                        elif mode=='truncation':path.write_bytes(b'ab')
                        elif mode=='same-size':path.write_bytes(b'ABCDEF')
                        else:
                            path.rename(Path(directory)/'old');path.write_bytes(b'abcdef')
                    return data
                with patch.object(owner.os,'read',side_effect=drift):
                    with self.assertRaises(owner.Held) as error:owner.read_source(path,owner.Timer(Clock()))
                self.assertEqual(error.exception.args,('source_unavailable',))


if __name__=='__main__':unittest.main()
