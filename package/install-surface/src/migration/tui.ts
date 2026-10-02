/** Presentation only. The accepted controller owns every migration action. */
import { stringWidth } from 'bun';
import { canonical } from '../canonical-json.ts';
import { BoxRenderable, TextRenderable, SelectRenderable, ScrollBoxRenderable, CliRenderEvents, createCliRenderer, type CliRenderer, type KeyEvent } from '@opentui/core';
import { createMigrationController, validateMigrationView, validateMigrationRequest, type MigrationViewV1, type MigrationRequest, type MigrationActionId, type MigrationCommandResult } from './controller.ts';
import { WILL_ROLE_DESKS, type WillRoleDesk } from './contracts.ts';
export const MIGRATION_SECTIONS = ['Ecosystem', 'Organs', 'Work', 'Knowledge', 'Machine', 'Modules', 'Access', 'Services', 'Handoffs', 'Recovery'] as const;
export type MigrationSection = typeof MIGRATION_SECTIONS[number];
type Controller = ReturnType<typeof createMigrationController>;
export interface MigrationRow {
    id: string;
    title: string;
    summary: string;
    lines: string[];
    action?: MigrationActionId;
    tags?: string[];
}
export interface MigrationTuiResult extends MigrationCommandResult {
    presentation: 'closed' | 'NATIVE_TUI_UNAVAILABLE' | 'TERMINAL_CLOSED';
}
export interface MigrationTuiOptions {
    createRenderer?: typeof createCliRenderer;
    signal?: AbortSignal;
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
}
const clean = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '�');
const label = (text: string) => text.replaceAll('_', ' ');
function fields(value: unknown, prefix = ''): string[] {
    if (value === null || typeof value !== 'object')
        return [`${prefix}${clean(String(value))}`];
    if (Array.isArray(value))
        return value.length ? value.flatMap((v, i) => fields(v, `${prefix}[${i + 1}] `)) : [`${prefix}none supplied`];
    return Object.entries(value).flatMap(([k, v]) => typeof v === 'object' && v !== null ? [`${prefix}${label(k)}:`, ...fields(v, '  ')] : fields(v, `${prefix}${label(k)}: `));
}
function checked(view: unknown): MigrationViewV1 {
    if (!validateMigrationView(view))
        throw new Error('MIGRATION_VIEW_INVALID');
    return structuredClone(view);
}
const row = (id: string, title: string, lines: string[], summary = 'Source observation; no authority', tags: string[] = []): MigrationRow => ({ id, title, summary, lines, tags });
const effectLabel: Record<MigrationViewV1['effect_class'], string> = { none: 'No changes', 'read-only': 'Read only', 'local-manifest-write': 'Write public manifest', 'reviewed-local-transaction': 'Reviewed local changes', 'human-handoff': 'Human sign-in request' };
function reasonLabel(reason: string | null): string {
    if (!reason)
        return 'Owner checks still required';
    if (reason.includes('OWNER') || reason.includes('PORT'))
        return 'An approved owner connection is required';
    if (reason === 'BUSY')
        return 'Wait for the current request to settle';
    if (reason.includes('PROFILE'))
        return 'Select a destination scenario first';
    if (reason.includes('REVIEW'))
        return 'Independent review is required';
    if (reason.includes('PLAN'))
        return 'An approved plan is required';
    return label(reason.toLowerCase());
}
function actionRows(view: MigrationViewV1, ids?: readonly MigrationActionId[]): MigrationRow[] {
    return view.actions.filter(a => a.id !== 'select-profile' && (!ids || ids.includes(a.id))).map(a => ({ id: `action:${a.id}`, title: `${a.enabled ? 'REQUEST' : 'HELD'} ${a.id}`, summary: `${effectLabel[a.effect_class]} | ${reasonLabel(a.reason)}`, lines: [`Action: ${a.id}`, `Effect: ${a.effect_class}`, `Enabled: ${a.enabled}`, `Reason: ${a.reason ?? 'Owner checks still required'}`, 'Consent requests this action; it never authenticates the owner.', 'External sign-ins are not reversed by cancellation or rollback.'], action: a.id, tags: a.enabled ? [] : ['held'] }));
}
/** Project existing safe evidence only; no catalog, probe or owner accessor. */
export function migrationRows(input: MigrationViewV1, section: MigrationSection, role: WillRoleDesk | 'all' = 'all'): MigrationRow[] {
    const view = checked(input), s = view.snapshot, organs = [...(s?.organs.operating ?? []), ...(s?.organs.cognitive ?? [])];
    let rows: MigrationRow[] = [];
    switch (section) {
        case 'Ecosystem':
            rows = organs.map(o => row(`edge:${o.organ_id}`, `${o.organ_id} -> ${o.consumer}`, fields({ owner: o.owner, contract: o.contract, plant: o.plant, source_digest: o.source_digest, input_dependencies: o.input_dependencies, trigger: o.trigger, artifact_ref: o.artifact_ref, consumer: o.consumer, independent_verdict: o.independent_verdict, freshness: o.freshness }), `Admission ${o.admission}; verdict ${o.independent_verdict}`));
            break;
        case 'Organs':
            rows = organs.filter(o => role === 'all' || o.organ_id === 'will').map(o => row(`organ:${o.organ_id}`, o.organ_id, [...fields(o), 'Refusal bounds beyond this supplied contract: UNKNOWN'], `Admission ${o.admission}; runtime ${o.runtime}; verdict ${o.independent_verdict}`, ['pending', 'not-admitted', 'unknown'].includes(o.admission) ? ['held', 'unverified'] : o.verification !== 'verified' ? ['unverified'] : []));
            rows.push(...(s?.will_role_desks ?? []).filter(d => role === 'all' || d.desk === role).map(d => row(`role:${d.desk}`, `Will / ${d.desk}`, [...fields(d), 'Role filter only; no work admission, publishing, learning promotion or cadence.'], 'Display-only Will role')));
            break;
        case 'Work':
            rows = (s?.work_objects ?? []).map(w => row(`work:${w.work_id}`, w.work_id, [...fields(w), 'Project inventory beyond supplied work references: UNKNOWN'], w.binding_digest ? 'Bound source tuple; not authorization' : 'Source-only; nonauthoritative', w.binding_digest ? [] : ['held']));
            rows.push(...(s?.cell_effects ?? []).map((c, i) => row(`cell:${i}`, `${c.kind} / ${c.cell_id}`, fields(c), `Declared cell outcome: ${c.effect}`)));
            break;
        case 'Knowledge':
            rows = (s?.knowledge_refs ?? []).map(k => row(`knowledge:${k.ref_id}`, `${k.kind} / ${k.ref_id}`, fields(k), `Version ${k.version}; freshness ${k.freshness}`, k.freshness === 'fresh' ? [] : ['unverified']));
            break;
        case 'Machine':
            rows = [row('machine:profiles', 'Profile context', [`Selected destination: ${view.profile ?? 'unselected'}`, `Retained source snapshot: ${s?.profile ?? 'unknown'}`, `Retained plan profile: ${view.plan?.profile ?? 'unknown'}`, 'Compatibility observations are not destination identity or approval.', ...fields(s?.compatibility_observations ?? { destination_observations: 'UNKNOWN' })]), ...(s?.toolchain_requirements ?? []).map(t => row(`toolchain:${t.id}`, t.id, fields(t), 'Declared requirement; installation UNKNOWN')), row('machine:data', 'Data classifications', fields(s?.data_classifications ?? []))];
            break;
        case 'Modules':
            rows = [...new Set([...(s?.logical_module_refs ?? []), ...(view.plan?.selected_modules ?? [])])].map(id => row(`module:${id}`, id, [`Logical module: ${id}`, `Selected in retained plan: ${view.plan ? view.plan.selected_modules.includes(id) : 'UNKNOWN'}`, 'Module toggle/install selection is not exposed by this controller.', ...fields(view.plan?.steps.filter(step => step.module_id === id) ?? [])], 'Source reference; row selection is not installation'));
            break;
        case 'Access':
            rows = Object.entries(view.evidence).map(([key, value]) => row(`evidence:${key}`, `${key}: ${value}`, [`Destination observation / ${key}: ${value}`, 'Other evidence dimensions are independent.'], value === 'unknown' ? 'UNKNOWN observation' : 'Independent observation'));
            rows.push(...actionRows(view, ['request-sign-in']));
            break;
        case 'Services':
            rows = organs.map(o => row(`service:${o.organ_id}`, `${o.organ_id}: ${o.runtime}`, fields({ trigger: o.trigger, runtime: o.runtime, verification: o.verification, admission: o.admission, plant: o.plant }), 'Supplied organ observation; no service probe'));
            rows.push(...(s?.capability_hit_modes?.modes ?? []).map(m => row(`mode:${m.mode_id}`, m.mode_id, [...fields(m), 'No scheduling or enrollment permission.'], 'DISABLED')));
            break;
        case 'Handoffs':
            rows = view.handoffs.map((h, i) => row(`handoff:${i}`, h.kind, fields(h), 'Human handoff; not performed'));
            rows.push(...organs.map(o => row(`consumer:${o.organ_id}`, `${o.organ_id} -> ${o.consumer}`, fields({ consumer: o.consumer, artifact_lineage: o.artifact_lineage ?? 'UNKNOWN' }), 'Acknowledgment only where supplied')));
            break;
        case 'Recovery':
            rows = [row('operation', 'Current operation', fields(view.operation ?? { operation: 'not supplied' }), `${view.outcome} | ${view.effect_class}`), row('recovery:limits', 'Recovery observation limits', ['Last durable step: UNKNOWN; not exposed by owner API.', 'Backup availability: UNKNOWN.', 'Restoration verification: UNKNOWN.', 'Prior status is historical; it does not override current uncertainty.', 'External sign-ins remain independently owned.']), ...actionRows(view, ['status', 'resume', 'rollback', 'release', 'cancel'])];
            break;
    }
    if (!rows.length)
        rows = [row('unknown', `${section}: UNKNOWN`, ['No corresponding public evidence supplied.', 'Rendering does not inspect the host or acquire owner inputs.'], 'UNKNOWN / not supplied', ['unverified'])];
    return rows;
}
export function migrationReviewRows(input: MigrationViewV1): MigrationRow[] {
    const view = checked(input), plan = view.plan;
    if (!plan)
        return [row('review:missing', 'Review: no plan acquired', ['Exact plan/source/binding context: UNKNOWN.', 'Use an enabled plan action with an explicitly selected profile.', 'Final review is not acquired by opening this screen.']), ...actionRows(view, ['plan'])];
    const { steps, final_review, terminal_release, ...identity } = plan;
    return [row('review:identity', 'Exact plan and source joins', [`Selected destination: ${view.profile ?? 'unselected'}`, `Retained source: ${view.snapshot?.profile ?? 'unknown'}`, `Retained plan: ${plan.profile}`, ...fields(identity)], `PROPOSED | ${steps.length} steps | ${plan.hold_count} holds`),
        ...steps.map(step => row(`step:${step.id}`, step.id, fields(step), `${step.module_id} | ${step.effect}`)),
        row('review:historical', 'Historical final work review', fields(final_review), final_review.state), row('review:release', 'Current terminal release context', fields(terminal_release), terminal_release.state),
        row('review:limits', 'Requirements are not observed backups', [...fields(plan.limits), 'Preimage availability: UNKNOWN', 'Backup availability: UNKNOWN', 'Restoration verification: UNKNOWN', 'A matching digest is not approval or current freshness.', 'External sign-ins are not reversed.']), ...actionRows(view, ['apply', 'rollback', 'release'])];
}
function wrap(lines: string[], width: number): Array<{
    text: string;
    line: number;
    offset: number;
}> {
    const result: Array<{
        text: string;
        line: number;
        offset: number;
    }> = [];
    lines.forEach((line, index) => { let text = '', offset = 0, start = 0; for (const char of clean(line)) {
        if (stringWidth(text + char) > width && text) {
            result.push({ text, line: index, offset: start });
            text = '';
            start = offset;
        }
        text += char;
        offset += char.length;
    } result.push({ text, line: index, offset: start }); });
    return result;
}
function anchorIndex(lines: ReturnType<typeof wrap>, line: number, offset: number): number { let index = 0; for (let i = 0; i < lines.length; i++) {
    const item = lines[i]!;
    if (item.line < line || item.line === line && item.offset <= offset)
        index = i;
    else
        break;
} return index; }
function fit(text: string, width: number): string { let result = ''; for (const char of clean(text)) {
    if (stringWidth(result + char) > width)
        break;
    result += char;
} return result; }
type Screen = 'scenario' | 'section' | 'sections' | 'detail' | 'review' | 'actions' | 'roles' | 'filters' | 'help' | 'form' | 'confirm';
interface PendingConfirmation { request: MigrationRequest; view: MigrationViewV1 }
function confirmationContext(view: MigrationViewV1, action: MigrationActionId): string {
    return canonical({ profile: view.profile, snapshot: view.snapshot ?? null, plan: view.plan ?? null, operation: view.operation ?? null, comparison: view.comparison ?? null, evidence: view.evidence, action: view.actions.find(item => item.id === action) });
}
function confirmationMatches(pending: PendingConfirmation, current: MigrationViewV1): boolean {
    return validateMigrationRequest(pending.request)
        && current.actions.some(action => action.id === pending.request.action && action.enabled)
        && confirmationContext(current, pending.request.action) === confirmationContext(pending.view, pending.request.action);
}
interface Navigation {
    screen: Screen;
    section: MigrationSection;
    query: string;
    role: WillRoleDesk | 'all';
    filter: string;
    index: number;
    top: number;
    focus: 'list' | 'detail';
    detail?: MigrationRow;
    confirmation?: PendingConfirmation;
    line: number;
    offset: number;
}
const fresh = (section: MigrationSection = 'Ecosystem'): Navigation => ({ screen: 'section', section, query: '', role: 'all', filter: 'all', index: 0, top: 0, focus: 'list', line: 0, offset: 0 });
const help = ['g sections | [ / ] adjacent section | s scenarios', 'a actions | r safe Review | w Will roles | f filters', 'Arrows / Home / End / PgUp / PgDn navigate', 'Tab / Shift-Tab changes visible focus', '/ search | Enter detail or explicit request', 'Esc returns with position | q backs out, then closes', 'Ctrl-C cancels through controller; possible effects are awaited.', 'Selection is not installation. Consent is not owner approval.'];
const labels: Partial<Record<MigrationActionId, string>> = { apply: 'Apply reviewed local transaction', resume: 'Resume reviewed local transaction', rollback: 'Roll back owned local changes', release: 'Release owned terminal claim', export: 'Export public manifest', 'request-sign-in': 'Request human sign-in handoff' };
/** Instance-local terminal boundary. OpenTUI logs some cleanup exceptions itself.
 * Keep those exceptions fixed before they enter the library; never replace console
 * or mutate the caller's stream methods. Stream errors still close the session.
 */
function terminalStream<T extends NodeJS.ReadStream | NodeJS.WriteStream>(stream: T, fault: () => void): T {
    const overrides = new Map<PropertyKey, unknown>();
    const failed = () => { fault(); return 'NATIVE_TUI_UNAVAILABLE'; };
    return new Proxy(stream, {
        get(target, key) {
            if (overrides.has(key))
                return overrides.get(key);
            let value: unknown;
            try {
                value = Reflect.get(target, key, target);
            }
            catch {
                throw failed();
            }
            if (typeof value !== 'function')
                return value;
            return (...args: unknown[]) => {
                if (key === 'write' && typeof args.at(-1) === 'function') {
                    const callback = args.at(-1) as (...args: unknown[]) => unknown;
                    args[args.length - 1] = (error: unknown, ...rest: unknown[]) => callback(error ? failed() : error, ...rest);
                }
                try {
                    return (value as (...args: unknown[]) => unknown).apply(target, args);
                }
                catch {
                    throw failed();
                }
            };
        },
        set(_target, key, value) { overrides.set(key, value); return true; },
    });
}
export async function runMigrationTui(controller: Controller, options: MigrationTuiOptions = {}): Promise<MigrationTuiResult> {
    let view = checked(controller.view()), state: Navigation = { ...fresh(), screen: view.profile === null ? 'scenario' : 'section' };
    const history: Navigation[] = [], sections = new Map<MigrationSection, Navigation>();
    let terminalFault = false;
    let renderer: CliRenderer | undefined, closed = false, pending = false, searching = false, searchBefore: Navigation | undefined, notice = '';
    let form: {
        action: MigrationActionId;
        keys: string[];
        values: Record<string, string>;
        input: string;
    } | undefined;
    let resolve!: (result: MigrationTuiResult) => void, reject!: (error: Error) => void;
    const completion = new Promise<MigrationTuiResult>((yes, no) => { resolve = yes; reject = no; });
    const removals: Array<() => void> = [];
    const listen = (emitter: NodeJS.EventEmitter, event: string, handler: (...args: any[]) => void) => { emitter.on(event, handler); removals.push(() => emitter.off(event, handler)); };
    const finish = (presentation: MigrationTuiResult['presentation']) => {
        if (closed)
            return;
        closed = true;
        form = undefined;
        delete state.confirmation;
        for (const remove of removals.splice(0))
            remove();
        try {
            if (renderer && !renderer.isDestroyed)
                renderer.destroy();
        }
        catch {
            terminalFault = true;
        }
        if (terminalFault)
            presentation = 'NATIVE_TUI_UNAVAILABLE';
        void controller.dispatch({ action: 'cancel' }).then(answer => { checked(answer.view); resolve({ ...answer, presentation }); }, () => reject(new Error('NATIVE_TUI_UNAVAILABLE'))).catch(() => reject(new Error('NATIVE_TUI_UNAVAILABLE')));
    };
    const abort = () => finish('closed');
    options.signal?.addEventListener('abort', abort, { once: true });
    removals.push(() => options.signal?.removeEventListener('abort', abort));
    if (options.signal?.aborted) {
        finish('closed');
        return completion;
    }
    try {
        const input = options.stdin ?? process.stdin, output = options.stdout ?? process.stdout;
        renderer = await (options.createRenderer ?? createCliRenderer)({ stdin: terminalStream(input, () => { terminalFault = true; }), stdout: terminalStream(output, () => { terminalFault = true; }), exitOnCtrlC: false, exitSignals: [], clearOnShutdown: true, useMouse: false, consoleMode: 'disabled' });
        // An abort during asynchronous setup still owns the returned renderer.
        if (closed) {
            if (!renderer.isDestroyed)
                renderer.destroy();
            return completion;
        }
        const destroyRoot = renderer.root.destroyRecursively.bind(renderer.root);
        renderer.root.destroyRecursively = () => { try {
            destroyRoot();
        }
        catch {
            terminalFault = true;
            throw 'NATIVE_TUI_UNAVAILABLE';
        } };
        listen(process, 'SIGWINCH', () => { try {
            if (output.columns && output.rows)
                renderer?.resize(output.columns, output.rows);
        }
        catch {
            finish('NATIVE_TUI_UNAVAILABLE');
        } });
        const root = new BoxRenderable(renderer, { id: 'migration', width: '100%', height: '100%', padding: 1, flexDirection: 'column', backgroundColor: '#101820' });
        const heading = new TextRenderable(renderer, { id: 'migration-heading', height: 5, flexShrink: 0, content: '', fg: '#eeeeee' });
        const body = new BoxRenderable(renderer, { width: '100%', flexGrow: 1, minHeight: 1, flexDirection: 'row', gap: 1 });
        const selector = new SelectRenderable(renderer, { id: 'migration-list', width: '100%', height: '100%', showDescription: false, wrapSelection: false, options: [], selectedBackgroundColor: '#28576b', selectedTextColor: '#ffffff' });
        const detail = new ScrollBoxRenderable(renderer, { id: 'migration-detail', height: '100%', flexGrow: 1, scrollX: false, scrollY: true });
        const text = new TextRenderable(renderer, { id: 'migration-detail-text', content: '', flexShrink: 0, fg: '#eeeeee' });
        detail.add(text);
        const footer = new TextRenderable(renderer, { id: 'migration-footer', height: 3, flexShrink: 0, content: '', fg: '#a5d9e8' });
        body.add(selector);
        body.add(detail);
        root.add(heading);
        root.add(body);
        root.add(footer);
        renderer.root.add(root);
        let rows: MigrationRow[] = [], wrapped: ReturnType<typeof wrap> = [], detailWidth = 70, capacity = 14, visibleTop = 0;
        const restoreDetailAnchor = () => {
            if (closed || detail.isDestroyed)
                return;
            detail.scrollTo(Math.max(0, anchorIndex(wrapped, state.line, state.offset)));
        };
        // ScrollBox updates its public scroll range during these layout notifications.
        // Restoring long content after a short screen must retry the logical anchor
        // after that update; scrolling in show() alone clamps against the old range.
        const afterDetailLayout = () => { try { restoreDetailAnchor(); } catch { finish('NATIVE_TUI_UNAVAILABLE'); } };
        listen(detail.content, 'resize', afterDetailLayout);
        listen(detail.viewport, 'resize', afterDetailLayout);
        const push = (screen: Screen) => { if (history.length === 16)
            history.shift(); history.push(structuredClone(state)); state = { ...state, screen, query: '', index: 0, top: 0, focus: 'list', line: 0, offset: 0, confirmation: undefined }; notice = ''; };
        const back = () => { form = undefined; notice = ''; const previous = history.pop(); if (previous)
            state = previous;
        else
            finish('closed'); };
        const changeSection = (section: MigrationSection) => { if (state.screen === 'section')
            sections.set(state.section, structuredClone(state)); state = structuredClone(sections.get(section) ?? fresh(section)); history.length = 0; notice = ''; };
        const show = () => {
            if (closed || !renderer)
                return;
            view = checked(controller.view());
            if (state.screen === 'confirm' && (!state.confirmation || !confirmationMatches(state.confirmation, view))) {
                state = { ...fresh('Recovery'), screen: view.plan ? 'review' : 'section' };
                history.length = 0;
                notice = 'Review changed; open the action again and confirm the current evidence.';
            }
            const wide = renderer.width >= 120, full = state.screen === 'detail' || state.screen === 'help' || state.screen === 'form' || state.screen === 'confirm';
            capacity = Math.max(1, renderer.height - 10);
            const width = Math.max(12, renderer.width - 2);
            if (state.screen === 'scenario')
                rows = [row('workstation', 'Replace workstation', ['Select workstation; no installation or readiness implied.']), row('always-on-node', 'Add node', ['Select always-on-node; independent of workstation.']), row('recovery', 'Recover operation', ['Select recovery; an original operation and owner remain required.'])];
            else if (state.screen === 'sections')
                rows = MIGRATION_SECTIONS.map(s => row(s, s, [`${s}: supplied public evidence only.`]));
            else if (state.screen === 'actions')
                rows = actionRows(view);
            else if (state.screen === 'review')
                rows = migrationReviewRows(view);
            else if (state.screen === 'roles')
                rows = ['all', ...WILL_ROLE_DESKS].map(role => row(role, role, ['Display-only role filter on Will.']));
            else if (state.screen === 'filters')
                rows = ['all', 'held', 'unverified', 'drifted', 'required', 'optional'].map(filter => row(filter, filter, ['Display-only evidence filter. Required/optional are UNKNOWN when not exposed.']));
            else if (!full)
                rows = migrationRows(view, state.section, state.role);
            if (!full && state.screen === 'section')
                rows = rows.filter(r => (state.filter === 'all' || r.tags?.includes(state.filter)) && `${r.title}\n${r.summary}\n${r.lines.join('\n')}`.toLowerCase().includes(state.query.toLowerCase()));
            if (!full && !rows.length)
                rows = [row('empty', 'No matching supplied evidence', ['Filter/search changed display only. Required/optional/drifted facts not supplied remain UNKNOWN.'], 'UNKNOWN / no matching rows')];
            state.index = Math.min(Math.max(0, state.index), Math.max(0, rows.length - 1));
            state.top = Math.max(0, Math.min(state.top, Math.max(0, rows.length - 1)));
            // Keep the logical bookmark independent of resize-only visibility clamps.
            visibleTop = Math.min(state.top, state.index);
            if (state.index >= visibleTop + capacity)
                visibleTop = state.index - capacity + 1;
            selector.visible = !full;
            selector.width = wide ? 38 : '100%';
            detail.visible = full || wide;
            detailWidth = Math.max(8, width - (wide && !full ? 40 : 0) - 1);
            text.width = detailWidth;
            let lines = state.screen === 'help' ? help : state.screen === 'detail' ? state.detail?.lines ?? [] : rows[state.index]?.lines ?? [];
            if (state.screen === 'form')
                lines = [`Input required: ${form?.keys[0] ?? ''}`, 'Private input is masked and kept only until this request closes.', `Value: ${'•'.repeat(Math.min(form?.input.length ?? 0, 48))}`, 'Enter continues; Esc discards.'];
            if (state.screen === 'confirm' && state.confirmation) {
                const { request, view: reviewedView } = state.confirmation;
                lines = [labels[request.action] ?? request.action, `Declared effect: ${reviewedView.actions.find(a => a.id === request.action)?.effect_class}`, 'Press Enter to REQUEST this exact action. Esc cancels the request.', ...('reviewed_digest' in request ? ['Exact reviewed plan digest:', request.reviewed_digest] : []), 'Private input references are supplied but not displayed.', 'Owner authentication and fresh preflight still control execution.', 'External sign-ins are not reversed.', ...(['apply', 'resume', 'rollback', 'release'].includes(request.action) ? migrationReviewRows(reviewedView).filter(r => !r.action).flatMap(r => [r.title, ...r.lines]) : [])];
            }
            wrapped = wrap(lines, detailWidth);
            text.content = wrapped.map(l => l.text).join('\n');
            text.height = Math.max(1, wrapped.length);
            restoreDetailAnchor();
            selector.options = rows.slice(visibleTop, visibleTop + capacity).map(r => ({ name: fit(r.title, wide ? 36 : width - 3), description: '', value: r.id }));
            selector.setSelectedIndex(state.index - visibleTop);
            if (full || wide && state.focus === 'detail')
                detail.focus();
            else
                selector.focus();
            const selected = rows[state.index];
            const title = state.screen === 'section' ? state.section : state.screen === 'detail' ? `Detail / ${state.detail?.title ?? ''}` : label(state.screen[0]!.toUpperCase() + state.screen.slice(1));
            heading.content = [fit(`Temperance Migration | ${title}`, width), fit(`Destination: ${view.profile ?? 'unselected'} | Source: ${view.snapshot?.profile ?? 'unknown'} | Plan: ${view.plan?.profile ?? 'unknown'}`, width), fit(`${wide ? 'List / detail' : 'Single panel'} | Focus: ${full ? 'detail' : wide ? state.focus : 'list'} | Row ${state.index + 1}/${rows.length} | Filter: ${state.filter} | Will: ${state.role}`, width), fit(`Status: ${label(view.outcome)} | Effect: ${effectLabel[view.effect_class]}`, width), fit(searching ? `Search: ${state.query}` : notice || selected?.summary || 'Selection never installs or authenticates.', width)].join('\n');
            footer.content = [fit('g sections  [ ] next  s scenarios  a actions  r Review  w roles  f filters', width), fit('/ search  arrows/page/home/end  Tab focus  Enter details/request', width), fit(pending ? 'Waiting for owner; Ctrl-C/q cancel and await actual effects.' : 'Esc back  q back/close  ? help | No profile readiness or authority grant', width)].join('\n');
        };
        const execute = (request: MigrationRequest, pendingConfirmation?: PendingConfirmation) => {
            const current = checked(controller.view()), action = current.actions.find(a => a.id === request.action);
            if (pendingConfirmation && !confirmationMatches(pendingConfirmation, current)) {
                state = { ...fresh('Recovery'), screen: current.plan ? 'review' : 'section' };
                history.length = 0;
                notice = 'Review changed; open the action again and confirm the current evidence.';
                show();
                return;
            }
            if (!action?.enabled) {
                notice = `Held: ${reasonLabel(action?.reason ?? 'ACTION_DISABLED')}`;
                show();
                return;
            }
            pending = true;
            form = undefined;
            delete state.confirmation;
            state = { ...fresh('Recovery') };
            void controller.dispatch(request, { signal: options.signal }).then(answer => {
                if (closed)
                    return;
                checked(answer.view);
                pending = false;
                history.length = 0;
                state = { ...fresh(request.action === 'select-profile' ? 'Ecosystem' : 'Recovery'), screen: request.action === 'plan' ? 'review' : 'section' };
                notice = '';
                show();
            }).catch(() => finish('NATIVE_TUI_UNAVAILABLE'));
            show();
        };
        const propose = (request: MigrationRequest) => {
            if (!validateMigrationRequest(request)) {
                notice = 'ARGUMENT_INVALID; input discarded.';
                form = undefined;
                back();
                show();
                return;
            }
            const reviewedView = checked(controller.view());
            const action = reviewedView.actions.find(a => a.id === request.action);
            if (!action?.enabled) {
                notice = `Held: ${reasonLabel(action?.reason ?? 'ACTION_DISABLED')}`;
                show();
                return;
            }
            if (action.effect_class === 'none' || action.effect_class === 'read-only')
                execute(request);
            else {
                form = undefined;
                if (state.screen === 'form')
                    state = history.pop() ?? fresh(state.section);
                if ('reviewed_digest' in request && (!reviewedView.plan || request.reviewed_digest !== reviewedView.plan.plan_digest
                    || 'operation' in request && request.operation !== reviewedView.operation?.txid)) {
                    notice = 'Acquire the current exact plan and operation review before confirming.';
                    show();
                    return;
                }
                push('confirm');
                state.confirmation = { request: structuredClone(request), view: reviewedView };
                show();
            }
        };
        const requestAction = (id: MigrationActionId) => {
            const current = checked(controller.view()), action = current.actions.find(a => a.id === id);
            if (!action?.enabled) {
                notice = `Held: ${reasonLabel(action?.reason ?? 'ACTION_DISABLED')}`;
                show();
                return;
            }
            if (id === 'inspect' || id === 'cancel' || id === 'request-sign-in') {
                propose({ action: id });
                return;
            }
            if (id === 'plan') {
                if (!current.profile) {
                    push('scenario');
                    show();
                }
                else
                    propose({ action: 'plan', profile: current.profile });
                return;
            }
            if (id === 'select-profile') {
                push('scenario');
                show();
                return;
            }
            const values: Record<string, string> = {}, keys = id === 'export' ? ['output'] : id === 'diff' ? ['bundle', 'host_binding'] : id === 'apply' ? ['plan', 'reviewed_digest'] : id === 'status' ? ['operation'] : ['operation', 'reviewed_digest'];
            if (current.operation)
                values.operation = current.operation.txid;
            if (current.plan)
                values.reviewed_digest = current.plan.plan_digest;
            const missing = keys.filter(k => !values[k]);
            const make = () => ({ action: id, ...values, ...(id === 'export' ? { manifest_only: true } : {}) }) as MigrationRequest;
            if (!missing.length)
                propose(make());
            else {
                form = { action: id, keys: missing, values, input: '' };
                push('form');
                show();
            }
        };
        const onKey = (key: KeyEvent) => {
            if (closed)
                return;
            key.preventDefault();
            key.stopPropagation();
            if (key.ctrl && key.name === 'c') {
                finish('closed');
                return;
            }
            if (pending) {
                if (key.name === 'q' || key.name === 'escape')
                    finish('closed');
                return;
            }
            const enter = key.name === 'return' || key.name === 'enter';
            if (searching) {
                if (key.name === 'escape') {
                    if (searchBefore)
                        state = searchBefore;
                    searching = false;
                    show();
                    return;
                }
                else if (enter)
                    searching = false;
                else if (key.name === 'backspace')
                    state.query = state.query.slice(0, -1);
                else if (!key.ctrl && !key.meta && key.sequence.length === 1 && state.query.length < 120)
                    state.query += clean(key.sequence);
                state.index = 0;
                state.top = 0;
                show();
                return;
            }
            if (state.screen === 'form' && form) {
                if (key.name === 'escape' || key.ctrl && key.name === 'c') {
                    back();
                    show();
                    return;
                }
                if (enter) {
                    form.values[form.keys.shift()!] = form.input;
                    form.input = '';
                    if (!form.keys.length) {
                        const request = { action: form.action, ...form.values, ...(form.action === 'export' ? { manifest_only: true } : {}) } as MigrationRequest;
                        propose(request);
                        return;
                    }
                }
                else if (key.name === 'backspace')
                    form.input = form.input.slice(0, -1);
                else if (!key.ctrl && !key.meta && key.sequence.length === 1 && form.input.length < 4096 && !/[\x00-\x1f\x7f]/.test(key.sequence))
                    form.input += key.sequence;
                show();
                return;
            }
            if (key.name === 'escape' || key.name === 'q') {
                back();
                if (!closed)
                    show();
                return;
            }
            if (state.screen === 'confirm' && enter) {
                const exact = state.confirmation;
                if (exact) execute(exact.request, exact);
                else show();
                return;
            }
            if (enter) {
                const selected = rows[state.index];
                if (!selected)
                    return;
                if (state.screen === 'scenario')
                    execute({ action: 'select-profile', profile: selected.id as 'workstation' | 'always-on-node' | 'recovery' });
                else if (state.screen === 'sections') {
                    changeSection(selected.id as MigrationSection);
                    show();
                }
                else if (state.screen === 'roles') {
                    const role = selected.id as WillRoleDesk | 'all';
                    back();
                    state.role = role;
                    state.section = 'Organs';
                    state.screen = 'section';
                    state.index = 0;
                    state.top = 0;
                    show();
                }
                else if (state.screen === 'filters') {
                    const filter = selected.id;
                    back();
                    state.filter = filter;
                    state.index = 0;
                    state.top = 0;
                    show();
                }
                else if (selected.action)
                    requestAction(selected.action);
                else if (state.screen !== 'detail' && state.screen !== 'help') {
                    push('detail');
                    state.detail = structuredClone(selected);
                    state.focus = 'detail';
                    show();
                }
                return;
            }
            if (key.name === 'tab') {
                if (renderer!.width >= 120 && !['detail', 'help', 'form', 'confirm'].includes(state.screen))
                    state.focus = state.focus === 'list' ? 'detail' : 'list';
                show();
                return;
            }
            if (key.name === '/' && state.screen === 'section') {
                searchBefore = structuredClone(state);
                searching = true;
                show();
                return;
            }
            const screenKeys: Record<string, Screen> = { g: 'sections', s: 'scenario', a: 'actions', r: 'review', w: 'roles', f: 'filters', '?': 'help' };
            if (screenKeys[key.name]) {
                push(screenKeys[key.name]!);
                show();
                return;
            }
            if (key.name === '[' || key.name === ']') {
                const index = MIGRATION_SECTIONS.indexOf(state.section);
                changeSection(MIGRATION_SECTIONS[(index + (key.name === ']' ? 1 : 9)) % 10]!);
                show();
                return;
            }
            const delta = key.name === 'up' ? -1 : key.name === 'down' ? 1 : key.name === 'pageup' ? -capacity : key.name === 'pagedown' ? capacity : 0;
            if (['detail', 'help', 'confirm'].includes(state.screen) || renderer!.width >= 120 && state.focus === 'detail') {
                let at = Math.max(0, anchorIndex(wrapped, state.line, state.offset));
                at = key.name === 'home' ? 0 : key.name === 'end' ? wrapped.length - 1 : Math.max(0, Math.min(wrapped.length - 1, at + delta));
                const anchor = wrapped[at];
                if (anchor) {
                    state.line = anchor.line;
                    state.offset = anchor.offset;
                }
            }
            else {
                state.index = key.name === 'home' ? 0 : key.name === 'end' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, state.index + delta));
                state.top = Math.max(0, Math.min(visibleTop, state.index));
                if (state.index >= state.top + capacity)
                    state.top = state.index - capacity + 1;
                state.line = 0;
                state.offset = 0;
            }
            show();
        };
        listen(renderer.keyInput, 'keypress', (...args) => { try {
            onKey(args[0]);
        }
        catch {
            finish('NATIVE_TUI_UNAVAILABLE');
        } });
        listen(renderer, CliRenderEvents.RESIZE, () => { try {
            show();
        }
        catch {
            finish('NATIVE_TUI_UNAVAILABLE');
        } });
        listen(renderer, CliRenderEvents.DESTROY, () => finish('TERMINAL_CLOSED'));
        listen(renderer, CliRenderEvents.RENDER_ERROR, () => finish('NATIVE_TUI_UNAVAILABLE'));
        listen(renderer, CliRenderEvents.HANDLER_ERROR, () => finish('NATIVE_TUI_UNAVAILABLE'));
        for (const event of ['end', 'close', 'error'])
            listen(renderer.stdin, event, () => finish('TERMINAL_CLOSED'));
        for (const event of ['close', 'error'])
            listen(options.stdout ?? process.stdout, event, () => finish('TERMINAL_CLOSED'));
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
            listen(process, signal, abort);
        show();
        renderer.start();
    }
    catch {
        finish('NATIVE_TUI_UNAVAILABLE');
    }
    return completion;
}
