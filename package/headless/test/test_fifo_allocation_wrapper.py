from pathlib import Path
import hashlib
import unittest

def load(file,pin=None):
    p=Path(__file__).resolve().parents[1]/'lib'/file
    with p.open('rb') as f:b=f.read(65537)
    if len(b)>65536 or pin and hashlib.sha256(b).hexdigest()!=pin:raise RuntimeError('source drift')
    ns={'__name__':'fixed_'+file.replace('-','_')};exec(compile(b,str(p),'exec'),ns);return ns
W=load('fifo-allocation-wrapper.py')
P=load('bootstrap-fd-action-plan.py','6247e67239cde45713f59bac223c0ba765804b9a7969b0a3bbbeb5b8fc700b1f')
A=load('bootstrap-fd-preparation.py','bc69e73b3cb6128271ce034356bffb509b33023a08a3305e6a0412791c542ccf')
class Ops:
    def __init__(self):self.fd=20;self.rows={};self.paths={};self.log=[];self.closed=[];self.unlinked=[];self.fail_writer=None;self.available=True
    def mkdir(self,mode):self.log.append(('mkdir',mode));return self.directory_identity()
    def directory_identity(self):return dict(device=1,inode=1,kind='directory',mode=0o40700)
    def mkfifo(self,role,mode):self.log.append(('mkfifo',role));self.paths[role]=dict(device=1,inode=100+len(self.paths),kind='fifo',mode=0o10600);return dict(self.paths[role])
    def path_identity(self,role):return dict(self.paths[role])
    def new(self,kind,ino,access):
        fd=self.fd;self.fd+=1;self.rows[fd]=dict(fd=fd,device=1,inode=ino,kind=kind,access_mode=access,status_flags=access,descriptor_flags=1);return fd
    def open_directory(self):return self.new('directory',1,0)
    def open_null(self):return self.new('character',2,2)
    def open_reader(self,role):self.log.append(('reader',role));return self.new('fifo',self.paths[role]['inode'],0)
    def open_writer(self,role):
        self.log.append(('writer',role))
        if role==self.fail_writer:raise RuntimeError('ENXIO fixture')
        assert any(r['inode']==self.paths[role]['inode'] and r['access_mode']==0 for r in self.rows.values())
        return self.new('fifo',self.paths[role]['inode'],1)
    def identity(self,fd):return dict(self.rows[fd])
    def dup_command_available(self):return self.available
    def duplicate(self,source,cmd,minfd):
        self.log.append(('duplicate',cmd,minfd));assert cmd==67 and minfd==8
        fd=self.fd;self.fd+=1;self.rows[fd]=dict(self.rows[source],fd=fd,descriptor_flags=self.rows[source]['descriptor_flags']|1);return fd
    def close(self,fd):self.closed.append(fd);return True
    def unlink(self,role):self.unlinked.append(role);return True
    def rmdir(self):self.log.append(('rmdir',));return True
class Tests(unittest.TestCase):
    def setup(self,diag=False):
        self.now=0;self.ops=Ops();self.receipts=tuple(dict(nonce='a'*32,counter=i,launch_limit=2) for i in (1,2))
        self.w=W['Wrapper'](self.ops,0,2_000_000_000,lambda:self.now,self.receipts,diag)
        self.prep=A['Preparation'](0,2_000_000_000,lambda:self.now,P['plan_actions'],diag)
    def prepare(self):return self.prep.run(self.receipts,self.w.allocate,self.w.identity,self.w.close)
    def test_actual_preparation_reader_first_pending_member(self):
        self.setup();r=self.prepare();self.assertEqual(r['status'],'prepared-metadata');self.assertEqual(len(self.w.fds),18);self.assertEqual(self.w.pending,{})
        for role in W['ROLES']:self.assertLess(self.ops.log.index(('reader',role)),self.ops.log.index(('writer',role)))
        self.assertEqual(len([v for v in self.ops.log if v[0]=='duplicate']),6)
    def test_no_extra_diagnostic(self):
        self.setup(True);self.prepare();self.assertEqual(len(self.w.fds),19);self.assertEqual(len(self.w.paths),6);self.assertEqual(self.prep.plan['owned_peak'],18)
    def test_write_child_parent_callback_no_reopen(self):
        self.setup();self.w.allocate('parent',None);self.w.allocate('null',None);child=self.w.allocate('status_write-child',None);parent=self.w.pending['status_write'];actual=self.w.allocate('status_write-parent',None)
        self.assertEqual(parent,actual);self.assertNotEqual(child,parent);self.assertEqual(self.ops.log.count(('reader','status_write')),1)
    def test_second_open_failure_preserves_pending(self):
        self.setup();self.ops.fail_writer='codec_write';r=self.prepare();self.assertEqual(r['status'],'held');self.assertIn('codec_write',self.w.pending);pending=self.w.pending['codec_write'];self.w.cleanup();self.assertIn(pending,self.ops.closed);self.assertEqual(len(self.ops.closed),len(set(self.ops.closed)));self.assertEqual(self.ops.unlinked,[]) # lost second-open result conservativeunknown
    def test_cleanup_once_path_order(self):
        self.setup();self.prepare();self.prep.teardown(self.w.identity,self.w.close);r=self.w.cleanup();self.assertEqual(len(self.ops.closed),18);self.assertEqual(len(self.ops.unlinked),5);self.assertTrue(r['rmdir_attempted']);self.w.cleanup();self.assertEqual(len(self.ops.closed),18);self.assertEqual(len(self.ops.unlinked),5)
    def test_replacement_unknown_no_path_delete(self):
        self.setup();self.prepare();first=next(iter(self.w.fds));self.ops.rows[first]['inode']=999;self.w.cleanup();self.assertNotIn(first,self.ops.closed);self.assertEqual(self.ops.unlinked,[]);self.assertTrue(self.w.unknown)
    def test_dup_unavailable_no_fallback(self):
        self.setup();self.ops.available=False;r=self.prepare();self.assertEqual(r['status'],'held');self.assertEqual(self.ops.log.count(('duplicate',67,8)),0)
    def test_late_intermediate_fd_retained(self):
        self.setup();old=self.ops.open_reader
        def reader(role):fd=old(role);self.now=1_500_000_000;return fd
        self.ops.open_reader=reader;r=self.prepare();self.assertEqual(r['status'],'held');self.assertEqual(len(self.w.fds),3);self.assertIn(None,self.w.fds.values());self.w.cleanup();self.assertTrue(self.w.unknown);self.assertEqual(self.ops.unlinked,[])
    def test_missing_second_no_ops(self):
        self.setup()
        with self.assertRaises(W['Held']):W['Wrapper'](self.ops,0,2_000_000_000,lambda:0,self.receipts[:1])
        self.assertEqual(self.ops.log,[])
    def test_close_error_safe_peers(self):
        self.setup();self.prepare();old=self.ops.close;first=next(iter(self.w.fds))
        def close(fd):
            old(fd)
            if fd==first:raise RuntimeError('private')
            return True
        self.ops.close=close;self.w.cleanup();self.assertEqual(len(self.ops.closed),18);self.assertEqual(self.ops.unlinked,[]);self.w.cleanup();self.assertEqual(len(self.ops.closed),18)
    def test_shared_cleanup_deadline(self):
        self.setup();self.prepare();self.now=2_500_000_000;r=self.w.cleanup();self.assertTrue(r['cleanup_unknown']);self.assertEqual(self.ops.closed,[])
    def test_cleanup_reentrant_path_no_recursion(self):
        self.setup();self.prepare();old=self.ops.path_identity;counts=[]
        def identity(role):counts.append(role);self.w.cleanup();return old(role)
        self.ops.path_identity=identity;r=self.w.cleanup()
        self.assertTrue(r['cleanup_unknown']);self.assertEqual(len(counts),5);self.assertEqual(len(self.ops.unlinked),5);self.assertFalse(r['rmdir_attempted']);self.w.cleanup();self.assertEqual(len(counts),5)
    def test_cleanup_reentrant_directory_no_recursion(self):
        self.setup();self.prepare();old=self.ops.directory_identity;counts=[]
        def identity():counts.append(1);self.w.cleanup();return old()
        self.ops.directory_identity=identity;r=self.w.cleanup();self.assertTrue(r['cleanup_unknown']);self.assertEqual(len(counts),1);self.assertFalse(r['rmdir_attempted']);self.w.cleanup();self.assertEqual(len(counts),1)
    def test_pending_fd_identity_immutable(self):
        self.setup();self.prepare();first=next(iter(self.w.fds))
        with self.assertRaises(TypeError):self.w.fds[first]['inode']=9
if __name__=='__main__':unittest.main()
