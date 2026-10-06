"""Pure mock-metadata file action plan. No FD, fcntl, native call or spawn."""
from types import MappingProxyType
ROLES=('codec_read','codec_write','status_write','release_read','context_read')
ACCESS=(0,1,1,0,0)
RECORD_KEYS={'fd','device','inode','kind','access_mode','status_flags','descriptor_flags'}
class Held(Exception):pass
def closed(value,keys):
    if type(value) is not dict or len(value)!=len(keys) or any(type(k) is not str or len(k)>64 for k in value) or set(value)!=keys:raise Held('metadata_invalid')
def integer(v,low,high):
    if type(v) is not int or not low<=v<=high:raise Held('metadata_invalid')
    return v
def record(v,kind,access,*,staged=False):
    closed(v,RECORD_KEYS)
    integer(v['fd'],8 if staged else 0,2**31-1);integer(v['device'],0,2**63-1);integer(v['inode'],1,2**63-1)
    if type(v['kind']) is not str or v['kind']!=kind or type(v['access_mode']) is not int or v['access_mode']!=access:raise Held('metadata_invalid')
    integer(v['status_flags'],0,2**31-1);integer(v['descriptor_flags'],0,2**31-1)
    if v['status_flags']&3!=access or staged and not v['descriptor_flags']&1:raise Held('metadata_invalid')
    return MappingProxyType(dict(v))
def identity(v):return v['device'],v['inode'],v['kind']
def plan_actions(context):
    closed(context,{'schema','parent','channels','null','stages','cloexec_default_reported'})
    if type(context['schema']) is not str or context['schema']!='temperance.bootstrap-fd-metadata.v1' or type(context['cloexec_default_reported']) is not bool:raise Held('metadata_invalid')
    closed(context['channels'],set(ROLES));closed(context['stages'],{*ROLES,'null'})
    parent=record(context['parent'],'directory',0);null=record(context['null'],'character',2)
    originals=[parent,null];children={};channel_ids=[]
    for role,access in zip(ROLES,ACCESS):
        pair=context['channels'][role];closed(pair,{'child','parent'})
        child=record(pair['child'],'fifo',access);other=record(pair['parent'],'fifo',1-access)
        if identity(child)!=identity(other):raise Held('channel_identity_changed')
        channel_ids.append(identity(child));children[role]=child;originals.extend((child,other))
    if len(set(channel_ids))!=5:raise Held('channel_identity_duplicate')
    original_fds=[v['fd'] for v in originals]
    if len(set(original_fds))!=12:raise Held('original_fd_duplicate')
    stages={}
    for name in (*ROLES,'null'):
        source=null if name=='null' else children[name];stage=record(context['stages'][name],source['kind'],source['access_mode'],staged=True)
        if identity(stage)!=identity(source) or stage['status_flags']!=source['status_flags'] or stage['descriptor_flags']!=source['descriptor_flags']|1:raise Held('stage_identity_changed')
        stages[name]=stage
    stage_fds=[v['fd'] for v in stages.values()]
    if len(set(stage_fds))!=6 or set(stage_fds)&set(original_fds):raise Held('stage_fd_collision')
    owned=tuple(sorted((*original_fds,*stage_fds)))
    if len(owned)!=18:raise Held('owned_bound')
    actions=[('dup2',stages['null']['fd'],target) for target in range(3)]
    actions.extend(('dup2',stages[role]['fd'],target) for role,target in zip(ROLES,range(3,8)))
    actions.extend(('close',fd) for fd in owned if fd>7)
    return MappingProxyType({'schema':'temperance.bootstrap-fd-action-plan.v1','actions':tuple(actions),'owned_fds':owned,'owned_peak':18,'dup2_count':8,'known_close_count':sum(fd>7 for fd in owned),'reported_cloexec_default':context['cloexec_default_reported'],'unknown_inherited_fd_closure_verified':False,'actual_native_readiness':False,'execution_authorized':False,'capacity_authorization':False,'inference_authorized':False})
