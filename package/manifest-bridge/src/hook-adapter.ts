import { normalizeEvent } from './contract';
import { canonicalCwd, identityForCwd, readProjectIdentity } from './project';

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
}

function classifierValue(value: Record<string, unknown>, key: 'MODE' | 'TIER'): string | undefined {
  const direct = clean(value[key.toLowerCase()]);
  if (direct) return direct.toUpperCase();
  const context = [value.additionalContext, value.additional_context].find((entry) => typeof entry === 'string');
  if (typeof context !== 'string') return undefined;
  const match = context.match(new RegExp(`${key}\\s*:\\s*([A-Z0-9_-]+)`, 'i'));
  return match?.[1]?.toUpperCase();
}

function eventKind(hook: string, tool: string | undefined): string {
  const normalized = hook.toLowerCase();
  if (normalized === 'userpromptsubmit') return 'prompt.submitted';
  if (normalized === 'sessionstart') return 'session.started';
  if (normalized === 'sessionend') return 'session.stopped';
  if (normalized === 'subagentstop') return 'agent.stopped';
  if (normalized === 'stop') return 'run.stopped';
  if (normalized === 'pretooluse') return tool === 'Agent' ? 'agent.started' : 'tool.started';
  if (normalized === 'posttooluse') return tool === 'Agent' ? 'agent.completed' : 'tool.completed';
  return `hook.${normalized.replace(/[^a-z0-9]+/g, '_')}`;
}

export function hookInputToEvent(input: unknown, cwd = process.cwd()) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const hook = clean(value.hook_event_name) || 'unknown';
  const tool = clean(value.tool_name);
  const toolInput = value.tool_input && typeof value.tool_input === 'object' ? value.tool_input as Record<string, unknown> : {};
  const toolResponsePresent = value.tool_response !== undefined || value.tool_output !== undefined;
  const description = clean(toolInput.description);
  const subagentType = clean(toolInput.subagent_type);
  const failure = typeof value.error === 'string' || value.is_error === true;
  const project = readProjectIdentity(cwd) || identityForCwd(cwd);
  const mode = classifierValue(value, 'MODE');
  const tier = classifierValue(value, 'TIER');
  return normalizeEvent({
    source: 'pai-hook',
    kind: eventKind(hook, tool),
    status: failure ? 'failed' : 'observed',
    actor: 'hook',
    project_id: project.project_id,
    task_id: clean(value.task_id),
    session_id: clean(value.session_id),
    agent_id: clean(value.agent_id) || (tool === 'Agent' ? description : undefined),
    correlation_id: clean(value.correlation_id),
    phase: clean(value.phase)?.toUpperCase(),
    payload: {
      hook_event_name: hook,
      tool_name: tool,
      tool_response_present: toolResponsePresent,
      tool_input_keys: Object.keys(toolInput).slice(0, 40),
      description,
      subagent_type: subagentType,
      prompt_present: typeof value.prompt === 'string' || typeof toolInput.prompt === 'string',
      project_name: project.name,
      project_cwd: canonicalCwd(cwd),
      mode,
      tier,
    },
    evidence: typeof value.transcript_path === 'string' ? [{ label: 'transcript', path: value.transcript_path }] : [],
  });
}
