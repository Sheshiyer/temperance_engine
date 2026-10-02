import { expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { CliRenderEvents } from '@opentui/core';
import { createMigrationController, validateMigrationView } from '../src/migration/controller.ts';
import { workstationSnapshot, alwaysOnNodeSnapshot } from './migration-fixtures.ts';
async function implementation() {
    const module = await import('../src/migration/tui.ts').catch(() => null);
    expect(module?.runMigrationTui).toBeFunction();
    return module!;
}
for (const [width, height] of [[80, 24], [120, 40]])
    test(`migration ${width}x${height} explicitly selects both scenarios and retains independent source profile`, async () => {
        const { runMigrationTui } = await implementation();
        const ui = await createTestRenderer({ width, height });
        const controller = createMigrationController({ snapshot: workstationSnapshot });
        const run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
        try {
            const first = await ui.waitForFrame(f => f.includes('Replace workstation'));
            expect(first).toContain('Destination: unselected');
            expect(first).toContain('Add node');
            expect(first).toContain('Recover operation');
            ui.mockInput.pressArrow('down');
            ui.mockInput.pressEnter();
            const selected = await ui.waitForFrame(f => f.includes('Destination: always-on-node'));
            expect(selected).toContain('Source: workstation');
            expect(controller.view().profile).toBe('always-on-node');
            ui.mockInput.pressKey('s');
            await ui.waitForFrame(f => f.includes('Replace workstation'));
            ui.mockInput.pressEnter();
            await ui.waitForFrame(f => f.includes('Destination: workstation'));
            ui.mockInput.pressKey('q');
            const result = await run;
            expect(validateMigrationView(result.view)).toBe(true);
            expect(result.view.execution_authorized).toBe(false);
        }
        finally {
            ui.renderer.destroy();
        }
    });
test('all ten sections and Will filters render source relationships without dispatch or catalog promotion', async () => {
    const { migrationRows } = await implementation(), controller = createMigrationController({ snapshot: workstationSnapshot });
    const view = controller.view(), before = JSON.stringify(view);
    for (const section of ['Ecosystem', 'Organs', 'Work', 'Knowledge', 'Machine', 'Modules', 'Access', 'Services', 'Handoffs', 'Recovery'] as const)
        expect(migrationRows(view, section).length).toBeGreaterThan(0);
    const organs = migrationRows(view, 'Organs');
    expect(organs.filter(r => r.id.startsWith('organ:'))).toHaveLength(11);
    for (const role of ['head-of-marketing', 'copywriter', 'creative-strategist', 'launch-lead', 'seo-lead', 'analyst'] as const) {
        const rows = migrationRows(view, 'Organs', role);
        expect(rows.map(r => r.id)).toEqual(['organ:will', `role:${role}`]);
        expect(rows.flatMap(r => r.lines).join('\n')).toContain('assigned to organ: will');
    }
    expect(JSON.stringify(controller.view())).toBe(before);
});
test('section menu, search q, detail return, focus and real resize preserve navigation', async () => {
    const { runMigrationTui } = await implementation();
    const snapshot = structuredClone(workstationSnapshot);
    snapshot.logical_module_refs = Array.from({ length: 40 }, (_, i) => `core.module${String(i).padStart(2, '0')}`);
    const controller = createMigrationController({ snapshot }), ui = await createTestRenderer({ width: 120, height: 40 }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
    try {
        await ui.waitForFrame(f => f.includes('Replace workstation'));
        ui.mockInput.pressEnter();
        await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
        ui.mockInput.pressKey('g');
        await ui.waitForFrame(f => f.includes('Migration | Sections'));
        await ui.mockInput.pressKeys(Array(5).fill('ARROW_DOWN'));
        ui.mockInput.pressEnter();
        await ui.waitForFrame(f => f.includes('Migration | Modules'));
        ui.mockInput.pressKey('END');
        const bottom = await ui.waitForFrame(f => f.includes('module39'));
        expect(bottom).toContain('Focus: list');
        ui.mockInput.pressEnter();
        await ui.waitForFrame(f => f.includes('Migration | Detail'));
        ui.mockInput.pressEscape();
        await ui.waitForFrame(f => f.includes('module39'));
        ui.resize(80, 24);
        await ui.waitForFrame(f => f.includes('Single panel'));
        ui.resize(120, 40);
        const returned = await ui.waitForFrame(f => f.includes('List / detail'));
        expect(returned).toContain('module39');
        expect(returned).toContain('core.module10');
        ui.mockInput.pressTab();
        await ui.waitForFrame(f => f.includes('Focus: detail'));
        ui.resize(80, 24);
        await ui.waitForFrame(f => f.includes('Single panel') && f.includes('Focus: list'));
        ui.resize(120, 40);
        await ui.waitForFrame(f => f.includes('Focus: detail'));
        ui.mockInput.pressTab({ shift: true });
        await ui.waitForFrame(f => f.includes('Focus: list'));
        ui.mockInput.pressKey('/');
        await ui.mockInput.typeText('q');
        await ui.waitForFrame(f => f.includes('Search: q'));
        expect(ui.renderer.isDestroyed).toBe(false);
        ui.mockInput.pressEscape();
        await ui.waitForFrame(f => !f.includes('Search:') && f.includes('Row 40/40'));
        ui.mockInput.pressKey('q');
        await ui.flush();
        await run;
        expect(controller.view().snapshot).toEqual(snapshot);
    }
    finally {
        ui.renderer.destroy();
    }
});
for (const profile of ['workstation', 'always-on-node'] as const)
for (const [width, height] of [[80, 24], [120, 40]])
test(`${profile} ${width}x${height}: long detail anchor survives short Help and back after real resize`, async () => {
    const { runMigrationTui } = await implementation();
    const snapshot = structuredClone(profile === 'workstation' ? workstationSnapshot : alwaysOnNodeSnapshot);
    const digest = `sha256:${'29393846cd73873b221707d8175d67cc3e3735f107789e593bf049d6b377e4e7'}`;
    snapshot.organs.operating.find(organ => organ.organ_id === 'will')!.input_dependencies = Array.from({ length: 4 }, (_, index) => ({
        input_id: `input:fixture.0${index}`, producer_organ_id: 'will', consumer_organ_id: 'will', artifact_ref: `fixture:artifact.0${index}`,
        artifact_digest: digest, source_digest: digest, work_id: 'work:modular-mac-phase-a', task_id: `task:scroll.0${index}`, scope: profile,
    }));
    const controller = createMigrationController({ snapshot });
    await controller.dispatch({ action: 'select-profile', profile });
    const before = controller.view(), ui = await createTestRenderer({ width, height }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
    const other = width === 80 ? [120, 40] : [80, 24];
    const assertAnchor = () => {
        const frame = ui.captureCharFrame(), lines = frame.split('\n');
        expect(frame).toContain('Detail / will');expect(frame).toContain('Focus: detail');expect(frame).toContain('Will: analyst');
        expect(lines[6]!.slice(1, -1).trim()).toBe('[1] artifact ref: fixture:artifact.00');
        expect(lines.slice(7, 10).map(line => line.slice(1, ui.renderer.width - 2).trim()).join('')).toContain(digest);
    };
    try {
        await ui.waitForFrame(frame => frame.includes('Migration | Ecosystem'));
        ui.mockInput.pressKey(']');await ui.waitForFrame(frame => frame.includes('Migration | Organs'));
        ui.mockInput.pressKey('w');await ui.waitForFrame(frame => frame.includes('Migration | Roles'));
        ui.mockInput.pressKey('END');ui.mockInput.pressEnter();await ui.waitForFrame(frame => frame.includes('Will: analyst'));
        ui.mockInput.pressEnter();await ui.waitForFrame(frame => frame.includes('Detail / will'));
        ui.mockInput.pressKey('HOME');await ui.mockInput.pressKeys(Array(5).fill('ARROW_DOWN'));await ui.flush();assertAnchor();
        ui.resize(other[0]!, other[1]!);await ui.flush();assertAnchor();
        ui.resize(width!, height!);await ui.flush();assertAnchor();
        for (const close of ['escape', 'q']) {
            ui.mockInput.pressKey('?');await ui.waitForFrame(frame => frame.includes('Migration | Help'));await ui.flush();
            if (close === 'escape') ui.mockInput.pressEscape(); else ui.mockInput.pressKey('q');
            await ui.waitForFrame(frame => frame.includes('Detail / will'));await ui.flush();assertAnchor();
        }
        expect(controller.view()).toEqual(before);
        ui.mockInput.pressEscape();await ui.waitForFrame(frame => frame.includes('Migration | Organs'));
        ui.mockInput.pressKey('q');await run;
    } finally { ui.renderer.destroy(); }
});
test('renderer failure and external destroy share cancellation and remove owned listeners', async () => {
    const { runMigrationTui } = await implementation();
    for (const failure of ['render', 'destroy', 'signal', 'factory'] as const) {
        const controller = createMigrationController({ snapshot: workstationSnapshot }), abort = new AbortController();
        const before = process.listenerCount('SIGTERM');
        const ui = failure === 'factory' ? undefined : await createTestRenderer({ width: 80, height: 24 });
        const run = runMigrationTui(controller, { signal: abort.signal, createRenderer: async () => { if (!ui)
                throw new Error('/private/native-secret'); return ui.renderer; } });
        if (ui) {
            await ui.waitForFrame(f => f.includes('Replace workstation'));
            if (failure === 'render')
                ui.renderer.emit(CliRenderEvents.RENDER_ERROR, new Error('/private/native-secret'));
            else if (failure === 'destroy')
                ui.renderer.destroy();
            else
                abort.abort();
        }
        const result = await run;
        expect(validateMigrationView(result.view)).toBe(true);
        expect(result.view.outcome).toBe('cancelled');
        expect(JSON.stringify(result)).not.toContain('/private');
        expect(process.listenerCount('SIGTERM')).toBe(before);
        expect(ui?.renderer.isDestroyed ?? true).toBe(true);
    }
});
// Explicitly SYNTHETIC trusted-code owner. Real temporary OS IO; no production adapter.
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi';
import type { LifecycleIO } from '../src/lifecycle/journal.ts';
import { createCoreOnboardingCatalog } from '../src/onboarding/core-catalog.ts';
import { makeExpectedContext, fakeDigest } from './migration-fixtures.ts';
import { createMigrationPlan, calculateMigrationInputDigests, type CreateMigrationPlanOptions, type MigrationPlanReviewContext } from '../src/migration/planner.ts';
import { createMigrationOperation, migrationPreimageDigest } from '../src/migration/recovery.ts';
import { sha256 } from '../src/lifecycle/copy-tree.ts';
import { canonical } from '../src/canonical-json.ts';
import { migrationExitCode, type MigrationOwnerPorts, type MigrationRequest } from '../src/migration/controller.ts';
function fixture(profile: "workstation" | "always-on-node" = "workstation"): CreateMigrationPlanOptions {
    const base: Omit<CreateMigrationPlanOptions, "source_context"> = {
        snapshot: structuredClone(workstationSnapshot),
        target: { schema: "temperance.migration.target.v1" as const, version: { major: 1, minor: 0 }, target_profile: profile,
            destination_id: "destination:fixture", compatibility_check_only: true, requested_modules: ["core.fixture"], held_requirements: [] },
        profile, selected_modules: ["core.fixture"], backend: "none" as const,
        catalog: { ...createCoreOnboardingCatalog(), modules: [{ id: "core.fixture", title: "Fixture", summary: "Owned fixture", preselection: "available" as const,
                    depends_on: [], requires: [], guided_installs: [] }, ...createCoreOnboardingCatalog().modules] },
        host_profile: { schema: "temperance.host-profile.v1" as const, version: { major: 1 as const, minor: 0 as const }, id: "fixture",
            variables: [{ name: "STATE_ROOT", kind: "absolute-path" as const, required: true }], secret_references: [],
            preselected_modules: ["provider.9router"], required_routing_aliases: [] },
        private_binding: { schema: "temperance.host-binding.v1" as const, version: { major: 1 as const, minor: 0 as const }, profile_id: "fixture",
            variables: { STATE_ROOT: ["", "private", "fixture", "temperance"].join("/") }, secret_references: {}, routing_aliases: [], volume_bindings: [] },
        module_bindings: [{ module_id: "core.fixture", owner: "temperance", version: "1.0.0", source_digest: fakeDigest("fixture-module"),
                destinations: [{ id: "config.fixture", root_ref: "STATE_ROOT", relative_path: "config/fixture.json", effect: "configuration-create" as const,
                        prepared_digest: fakeDigest("prepared"), preimage_digest: fakeDigest("absent"), mode: 384 }], runtime_requirements: [] }],
        destination: { destination_id: "destination:fixture", issued_device_ref: "device:fixture-issued", identity_digest: fakeDigest("destination-identity"),
            platform: "darwin", architecture: "arm64", free_bytes: 8192, required_bytes: 1024, port_20128: "free" as const,
            roots: [{ root_ref: "STATE_ROOT", owner: "temperance", identity_digest: fakeDigest("root-identity"), state: "available" as const }], runtime_environments: [] },
        observations: [], expected_context: makeExpectedContext({ required_work_ids: ["work:modular-mac-phase-a"], required_organ_ids: [] }),
        now: "2026-10-01T00:00:02Z",
    };
    const digests = calculateMigrationInputDigests(base);
    return { ...base, source_context: { ...digests, destination_id: base.destination.destination_id, issued_device_ref: base.destination.issued_device_ref,
            profile, backend: base.backend, selected_modules: [...base.selected_modules], pinned_at: "2026-10-01T00:00:01Z", expires_at: "2026-10-02T00:00:00Z" } };
}
const nativeRename = process.platform === "darwin" ? dlopen("/usr/lib/libSystem.B.dylib", { renamex_np: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }, __error: { args: [], returns: FFIType.ptr } }) : null;
function diskIO(): LifecycleIO {
    return { mkdir: async (p, o) => { await fs.mkdir(p, o); }, writeFile: (p, d) => fs.writeFile(p, d), readFile: p => fs.readFile(p, "utf8"), readdir: p => fs.readdir(p), rm: (p, o) => fs.rm(p, o), lstat: p => fs.lstat(p), chmod: (p, m) => fs.chmod(p, m), rename: (a, b) => fs.rename(a, b), realpath: p => fs.realpath(p), now: () => new Date("2026-10-01T00:00:04Z"),
        renameNoReplace: nativeRename ? async (a, b) => {
            const from = Buffer.from(`${a}\0`), to = Buffer.from(`${b}\0`);
            // Darwin sys/stdio.h: RENAME_EXCL=0x4; actual atomic kernel primitive.
            if (nativeRename.symbols.renamex_np(ptr(from), ptr(to), 0x4) !== 0) {
                const errno = new Int32Array(toArrayBuffer(nativeRename.symbols.__error()!, 0, 4))[0];
                throw Object.assign(new Error("NOREPLACE_FAILED"), { code: errno === 17 ? "EEXIST" : "NATIVE_RENAME_FAILED", errno });
            }
        } : undefined,
        writeFileAtomic: async (p, d, o) => { const temp = `${p}.writing`; const handle = await fs.open(temp, "w", o?.mode ?? 0o600); try {
            await handle.writeFile(d);
            await handle.sync();
        }
        finally {
            await handle.close();
        } await fs.chmod(temp, o?.mode ?? 0o600); await fs.rename(temp, p); },
        fetch: async () => { throw new Error("NETWORK_FORBIDDEN"); }, execFile: async () => { throw new Error("EXEC_FORBIDDEN"); } };
}
async function syntheticOwner(profile: 'workstation' | 'always-on-node') {
    const root = await fs.mkdtemp(join(tmpdir(), 'migration-tui-owner-')), home = join(root, 'destination'), state = join(root, 'state'), destination = join(home, 'config', 'fixture.json');
    await fs.mkdir(join(home, 'config'), { recursive: true });
    await fs.mkdir(state);
    const prior = 'owned-before\n', output = 'owned-after\n';
    await fs.writeFile(destination, prior, { mode: 0o640 });
    await fs.writeFile(join(home, 'unowned'), 'untouched', { mode: 0o600 });
    const input = fixture(profile);
    input.private_binding.variables.STATE_ROOT = home;
    input.module_bindings[0]!.destinations[0]!.prepared_digest = `sha256:${sha256(output)}`;
    input.module_bindings[0]!.destinations[0]!.preimage_digest = migrationPreimageDigest(sha256(prior), 0o640) as `sha256:${string}`;
    Object.assign(input.source_context, calculateMigrationInputDigests(input));
    const pinned = structuredClone(input.source_context); // independently retained before proposal
    const plan = await createMigrationPlan(input);
    expect(plan.holds).toEqual([]);
    const { pinned_at: _p, expires_at: _e, ...bindings } = pinned;
    // Separate owner-issued review after the real accepted planner has completed.
    const review: MigrationPlanReviewContext = { ...bindings, plan_digest: plan.plan_digest, reviewed_at: '2026-10-01T00:00:03Z', expires_at: '2026-10-02T00:00:00Z' };
    const operation = createMigrationOperation();
    await fs.writeFile(join(root, 'inputs.json'), JSON.stringify(input), { mode: 0o600 });
    await fs.writeFile(join(root, 'issued.json'), JSON.stringify({ plan, review, operation }), { mode: 0o600 });
    let reviews = 0, authorized = 0, forbidden = 0;
    const ports = (io: LifecycleIO = diskIO()): MigrationOwnerPorts => {
        io.fetch = async () => { forbidden++; throw new Error('NETWORK_FORBIDDEN'); };
        io.execFile = async () => { forbidden++; throw new Error('EXEC_FORBIDDEN'); };
        return ({
            sourceContext: { readPinnedContext: async () => structuredClone(pinned) },
            planning: { readInputs: async () => { const { source_context: _s, ...rest } = JSON.parse(await fs.readFile(join(root, 'inputs.json'), 'utf8')); return rest; } },
            finalReview: { readFinalReview: async () => { reviews++; return JSON.parse(await fs.readFile(join(root, 'issued.json'), 'utf8')).review; } },
            recovery: { resolveOperation: async (request) => {
                    const packet = JSON.parse(await fs.readFile(join(root, 'issued.json'), 'utf8'));
                    return { operation: packet.operation, plan: packet.plan, stateRoot: state, io, root_tokens: { STATE_ROOT: 'HOME' }, ...(request.action === 'apply' ? { prepared: new Map(plan.steps.map(step => [step.id, output])) } : {}) };
                }, authority: { authorize: async (request) => {
                        const issued = JSON.parse(await fs.readFile(join(root, 'issued.json'), 'utf8'));
                        authorized++;
                        return { authorized: canonical(request.plan) === canonical(issued.plan) && canonical(request.review) === canonical(issued.review) && canonical(request.operation) === canonical(issued.operation), owned_step_ids: issued.plan.steps.map((step: {
                                id: string;
                            }) => step.id), lifecycle_state_root: state, remote_outcome: 'none' };
                    }, readFreshInputs: async (reader) => {
                        const observed = await reader.lstat(home);
                        if (!observed.isDirectory() || observed.isSymbolicLink())
                            throw new Error('ROOT_DRIFT');
                        const { source_context: _s, ...rest } = JSON.parse(await reader.readFile(join(root, 'inputs.json')));
                        return rest;
                    } } },
        });
    };
    const request = (action: 'apply' | 'status' | 'resume' | 'rollback' | 'release'): MigrationRequest => action === 'apply' ? { action, plan: 'owned-plan', reviewed_digest: plan.plan_digest } : action === 'status' ? { action, operation: operation.txid } : { action, operation: operation.txid, reviewed_digest: plan.plan_digest };
    return { root, home, state, destination, prior, output, input, plan, operation, ports, request, counts: () => ({ reviews, authorized, forbidden }) };
}
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
for (const profile of ['workstation', 'always-on-node'] as const)
    test(`${profile}: real planner safe Review is lossless, independent and never acquires review by rendering`, async () => {
        const { runMigrationTui, migrationReviewRows } = await implementation(), f = await syntheticOwner(profile), controller = createMigrationController({ ports: f.ports(), snapshot: workstationSnapshot });
        try {
            await controller.dispatch({ action: 'plan', profile });
            const projected = controller.view().plan!;
            expect(projected.final_review.state).toBe('not-acquired');
            expect(f.counts().reviews).toBe(0);
            const rows = migrationReviewRows(controller.view()), all = rows.flatMap(r => r.lines).join('\n');
            const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
            for (const value of strings(projected))
                expect(all).toContain(value);
            for (const forbidden of [f.root, f.operation.claim_nonce, 'issued_device_ref', 'private_binding'])
                expect(all).not.toContain(forbidden);
            expect(all).toContain('Backup availability: UNKNOWN');
            expect(all).toContain('Preimage availability: UNKNOWN');
            const before = canonical(controller.view()), ui = await createTestRenderer({ width: 80, height: 24 }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
            await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
            ui.mockInput.pressKey('r');
            await ui.waitForFrame(f => f.includes('Migration | Review'));
            ui.mockInput.pressEnter();
            await ui.waitForFrame(f => f.includes('Migration | Detail'));
            ui.mockInput.pressKey('END');
            await ui.flush();
            const bottom = ui.captureCharFrame();
            expect(bottom).toContain('Esc back');
            ui.resize(120, 40);
            await ui.flush();
            ui.resize(80, 24);
            await ui.flush();
            expect(ui.captureCharFrame()).toContain('Esc back');
            expect(canonical(controller.view())).toBe(before);
            expect(f.counts().reviews).toBe(0);
            ui.mockInput.pressCtrlC();
            await ui.flush();
            await run;
        }
        finally {
            await fs.rm(f.root, { recursive: true, force: true });
        }
    });
for (const profile of ['workstation', 'always-on-node'] as const)
    for (const close of ['ctrl-c', 'stream-end'] as const)
        test(`${profile}: ${close} waits for real disk promotion, then fresh headless owner reopens same operation`, async () => {
            const { runMigrationTui } = await implementation(), f = await syntheticOwner(profile), io = diskIO(), arrived = latch(), resume = latch();
            const rename = io.renameNoReplace!;
            io.renameNoReplace = async (a, b) => { await rename(a, b); if (b === f.destination) {
                arrived.release();
                await resume.promise;
            } };
            const controller = createMigrationController({ ports: f.ports(io), snapshot: workstationSnapshot });
            await controller.dispatch({ action: 'plan', profile });
            const ui = await createTestRenderer({ width: 120, height: 40 }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
            let settled = false;
            void run.then(() => { settled = true; });
            try {
                await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
                ui.mockInput.pressKey('r');
                await ui.waitForFrame(f => f.includes('Migration | Review'));
                ui.mockInput.pressKey('END');
                ui.mockInput.pressArrow('up');
                ui.mockInput.pressArrow('up');
                ui.mockInput.pressEnter();
                await ui.waitForFrame(f => f.includes('Input required: plan'));
                await ui.mockInput.typeText('owned-plan');
                ui.mockInput.pressEnter();
                await ui.waitForFrame(f => f.includes('REQUEST this exact action'));
                expect(f.counts().reviews).toBe(0);
                expect(await fs.readFile(f.destination, 'utf8')).toBe(f.prior);
                ui.mockInput.pressEscape();
                await ui.waitForFrame(f => f.includes('Migration | Review'));
                expect(f.counts().authorized).toBe(0);
                // Return to the form from the preserved Apply row; consent is a separate key.
                ui.mockInput.pressEnter();
                await ui.waitForFrame(f => f.includes('Input required: plan'));
                await ui.mockInput.typeText('owned-plan');
                ui.mockInput.pressEnter();
                await ui.waitForFrame(f => f.includes('REQUEST this exact action'));
                ui.mockInput.pressEnter();
                await ui.flush();
                await Promise.race([arrived.promise, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('PROMOTION_CHECKPOINT_NOT_REACHED')), 1000))]);
                expect(await fs.readFile(f.destination, 'utf8')).toBe(f.output);
                if (close === 'ctrl-c')
                    ui.mockInput.pressCtrlC();
                else
                    ui.renderer.stdin.emit('end');
                await ui.flush();
                await Promise.resolve();
                expect(settled).toBe(false);
                resume.release();
                const closed = await run;
                expect(validateMigrationView(closed.view)).toBe(true);
                expect(closed.view.effect_class).toBe('reviewed-local-transaction');
                expect(closed.view.outcome).not.toBe('cancelled');
                expect(closed.exitCode).toBe(migrationExitCode(closed.view));
                expect(closed.view.evidence.auth).toBe('unknown');
                const reopen = createMigrationController({ ports: f.ports() });
                const status = await reopen.dispatch(f.request('status'));
                expect(status.view.operation?.txid).toBe(f.operation.txid);
                expect(['committed', 'incomplete']).toContain(status.view.operation!.status);
                expect(await fs.readFile(join(f.home, 'unowned'), 'utf8')).toBe('untouched');
                expect(f.counts().forbidden).toBe(0);
                expect(JSON.stringify(closed)).not.toContain(f.root);
                expect(JSON.stringify(closed)).not.toContain(f.operation.claim_nonce);
            }
            finally {
                resume.release();
                ui.renderer.destroy();
                await run;
                await fs.rm(f.root, { recursive: true, force: true });
            }
        }, 15000);
test('all ten keyboard sections and six Will filters leave source evidence unchanged', async () => {
    const { runMigrationTui, MIGRATION_SECTIONS } = await implementation(), controller = createMigrationController({ snapshot: workstationSnapshot });
    await controller.dispatch({ action: 'select-profile', profile: 'always-on-node' });
    const before = canonical(controller.view()), ui = await createTestRenderer({ width: 120, height: 40 }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
    try {
        await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
        for (const section of MIGRATION_SECTIONS) {
            await ui.waitForFrame(f => f.includes(`Migration | ${section}`));
            ui.mockInput.pressKey(']');
        }
        await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
        ui.mockInput.pressKey(']');
        await ui.waitForFrame(f => f.includes('Migration | Organs'));
        for (let i = 1; i <= 6; i++) {
            ui.mockInput.pressKey('w');
            await ui.waitForFrame(f => f.includes('Migration | Roles'));
            await ui.mockInput.pressKeys(Array(i).fill('ARROW_DOWN'));
            ui.mockInput.pressEnter();
            const frame = await ui.waitForFrame(f => f.includes('Migration | Organs') && f.includes('Row 1/2'));
            expect(frame).toContain('Will:');
            ui.mockInput.pressKey('f');
            await ui.waitForFrame(f => f.includes('Migration | Filters'));
            ui.mockInput.pressEscape();
            await ui.waitForFrame(f => f.includes('Migration | Organs'));
        }
        expect(canonical(controller.view())).toBe(before);
        ui.mockInput.pressKey('a');
        await ui.waitForFrame(f => f.includes('Migration | Actions'));
        ui.mockInput.pressEnter();
        await ui.flush();
        expect(canonical(controller.view())).toBe(before);
        expect(ui.captureCharFrame()).toContain('approved owner connection');
        ui.mockInput.pressCtrlC();
        await ui.flush();
        await run;
    }
    finally {
        ui.renderer.destroy();
    }
});
test('invalid public projections never create a renderer or evaluate private accessor lists', async () => {
    const { runMigrationTui, migrationReviewRows } = await implementation(), valid = createMigrationController().view();
    let read = 0, created = 0;
    for (const list of ['actions', 'findings', 'handoffs'] as const) {
        const value = structuredClone(valid);
        Object.defineProperty(value[list], '0', { enumerable: true, get() { read++; return '/private/secret\x1b[31m'; } });
        expect(() => migrationReviewRows(value)).toThrow('MIGRATION_VIEW_INVALID');
        await expect(runMigrationTui({ view: () => value, dispatch: async () => { throw new Error('UNREACHABLE'); } }, { createRenderer: async () => { created++; throw new Error('UNREACHABLE'); } })).rejects.toThrow('MIGRATION_VIEW_INVALID');
    }
    expect(read).toBe(0);
    expect(created).toBe(0);
});
test('post-create errors, duplicate error events and preabort destroy exactly once with fixed diagnostics', async () => {
    const { runMigrationTui } = await implementation();
    for (const fault of ['postcreate', 'handler', 'stream-error', 'preabort'] as const) {
        const controller = createMigrationController(), abort = new AbortController();
        let destroys = 0, creates = 0;
        const ui = await createTestRenderer({ width: 80, height: 24 }), destroy = ui.renderer.destroy.bind(ui.renderer);
        ui.renderer.destroy = () => { destroys++; destroy(); };
        if (fault === 'postcreate')
            ui.renderer.root.add = () => { throw new Error('/private/setup-secret\x1b[31m'); };
        if (fault === 'preabort')
            abort.abort();
        const run = runMigrationTui(controller, { signal: abort.signal, createRenderer: async () => { creates++; return ui.renderer; } });
        if (fault === 'handler' || fault === 'stream-error') {
            await ui.waitForFrame(f => f.includes('Replace workstation'));
            if (fault === 'handler') {
                ui.renderer.emit(CliRenderEvents.HANDLER_ERROR, new Error('/private/handler-secret'));
                ui.renderer.emit(CliRenderEvents.RENDER_ERROR, new Error('duplicate'));
            }
            else
                ui.renderer.stdin.emit('error', new Error('/private/stream-secret'));
        }
        const result = await run;
        expect(JSON.stringify(result)).not.toContain('/private');
        expect(result.exitCode).toBe(migrationExitCode(result.view));
        expect(result.view.outcome).toBe('cancelled');
        expect(destroys).toBe(fault === 'preabort' ? 0 : 1);
        expect(creates).toBe(fault === 'preabort' ? 0 : 1);
        if (!ui.renderer.isDestroyed)
            destroy();
    }
});
import { nodeMigrationExportIO } from '../src/migration/export.ts';
for (const uncertain of [false, true])
    test(`export ${uncertain ? 'uncertain' : 'completed'} result survives renderer failure after actual publication`, async () => {
        const { runMigrationTui } = await implementation(), root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'migration-tui-export-'))), output = join(root, 'public.json'), entered = latch(), resume = latch();
        let calls = 0;
        const controller = createMigrationController({ snapshot: workstationSnapshot, ports: { manifestExport: { io: { ...nodeMigrationExportIO, publish: async (a, b) => { calls++; await nodeMigrationExportIO.publish(a, b); entered.release(); await resume.promise; if (uncertain)
                            throw new Error('/private/owner-secret'); } } } } });
        await controller.dispatch({ action: 'select-profile', profile: 'workstation' });
        const ui = await createTestRenderer({ width: 80, height: 24 }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
        let ended = false;
        void run.then(() => { ended = true; });
        try {
            await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
            ui.mockInput.pressKey('a');
            await ui.waitForFrame(f => f.includes('Migration | Actions'));
            ui.mockInput.pressArrow('down');
            ui.mockInput.pressEnter();
            await ui.waitForFrame(f => f.includes('Input required: output'));
            await ui.mockInput.typeText(output);
            await ui.flush();
            expect(ui.captureCharFrame()).not.toContain(root);
            ui.mockInput.pressEnter();
            await ui.waitForFrame(f => f.includes('REQUEST this exact action'));
            expect(calls).toBe(0);
            ui.mockInput.pressEnter();
            await ui.flush();
            await entered.promise;
            ui.renderer.emit(CliRenderEvents.RENDER_ERROR, new Error('/private/renderer-secret'));
            await Promise.resolve();
            expect(ended).toBe(false);
            resume.release();
            const result = await run;
            expect(result.presentation).toBe('NATIVE_TUI_UNAVAILABLE');
            expect(result.view.outcome).toBe(uncertain ? 'unknown-effect' : 'completed');
            expect(result.view.effect_class).toBe('local-manifest-write');
            expect(result.exitCode).toBe(uncertain ? 2 : 0);
            expect(result.view.actions).toEqual(controller.view().actions);
            expect(JSON.stringify(result)).not.toContain(root);
            expect(JSON.parse(await fs.readFile(output, 'utf8'))).toEqual(workstationSnapshot);
        }
        finally {
            resume.release();
            ui.renderer.destroy();
            await run;
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 15000);
test('513 accepted plan steps render completely; aliased rows cannot change controller evidence', async () => {
    const { runMigrationTui, migrationReviewRows } = await implementation(), input = fixture(), d = input.module_bindings[0]!.destinations[0]!;
    input.module_bindings[0]!.destinations = Array.from({ length: 513 }, (_, i) => ({ ...d, id: `config.fixture${String(i).padStart(3, '0')}`, relative_path: `config/fixture${i}.json` }));
    Object.assign(input.source_context, calculateMigrationInputDigests(input));
    const controller = createMigrationController({ ports: { sourceContext: { readPinnedContext: async () => input.source_context }, planning: { readInputs: async () => input } } });
    await controller.dispatch({ action: 'plan', profile: 'workstation' });
    const rows = migrationReviewRows(controller.view());
    expect(rows.filter(r => r.id.startsWith('step:'))).toHaveLength(513);
    rows[0]!.lines[0] = 'mutated';
    expect(migrationReviewRows(controller.view())[0]!.lines[0]).not.toBe('mutated');
    const ui = await createTestRenderer({ width: 80, height: 24 }), run = runMigrationTui(controller, { createRenderer: async () => ui.renderer });
    try {
        await ui.waitForFrame(f => f.includes('Migration | Ecosystem'));
        ui.mockInput.pressKey('r');
        await ui.waitForFrame(f => f.includes('Migration | Review'));
        ui.mockInput.pressKey('END');
        await ui.mockInput.pressKeys(Array(6).fill('ARROW_UP'));
        const last = await ui.waitForFrame(f => f.includes('config.fixture512'));
        expect(last).toContain('Esc back');
        ui.mockInput.pressEnter();
        await ui.waitForFrame(f => f.includes('Detail / config.fixture512'));
        ui.mockInput.pressCtrlC();
        await ui.flush();
        await run;
    }
    finally {
        ui.renderer.destroy();
    }
});
import type { PreparedReleaseEvidence } from '../src/lifecycle/executor.ts';
import { migrationReviewDigest, migrationReleaseEvidenceDigest, type MigrationTerminalReleaseContext } from '../src/migration/recovery.ts';
for (const profile of ['workstation', 'always-on-node'] as const)
    test(`${profile}: Review preserves expired work review separately from current terminal release; current uncertainty stays visible`, async () => {
        const { migrationReviewRows, migrationRows } = await implementation(), f = await syntheticOwner(profile), io = diskIO(), ports = f.ports(io), controller = createMigrationController({ ports });
        try {
            expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(0);
            const packet = JSON.parse(await fs.readFile(join(f.root, 'issued.json'), 'utf8')), tx = join(f.state, 'transactions', f.operation.txid), claim = join(f.state, 'prepared-transaction-claim'), binding = JSON.parse(await io.readFile(join(claim, 'owner.json'))).binding;
            const artifacts: PreparedReleaseEvidence['artifacts'] = [];
            const walk = async (relative: string): Promise<void> => { const path = join(tx, relative), stat = await io.lstat(path); artifacts.push({ path: relative, mode: stat.mode & 0o7777, hash: null }); for (const name of (await io.readdir(path)).sort()) {
                if (!relative && ['prepared-claim', 'released-claim'].includes(name))
                    continue;
                const child = relative ? relative + '/' + name : name, s = await io.lstat(join(tx, child));
                if (s.isDirectory())
                    await walk(child);
                else
                    artifacts.push({ path: child, mode: s.mode & 0o7777, hash: sha256(await io.readFile(join(tx, child))) });
            } };
            await walk('');
            const destinations: PreparedReleaseEvidence['destinations'] = [];
            for (const step of f.plan.steps) {
                const path = join(f.home, step.relative_path), stat = await io.lstat(path);
                destinations.push({ step_id: step.id, hash: sha256(await io.readFile(path)), mode: stat.mode & 0o7777 });
            }
            const evidence: PreparedReleaseEvidence = { kind: 'terminal', binding, capture_started: await io.lstat(join(claim, 'capture.json')).then(() => true, () => false), artifacts, destinations };
            const release: MigrationTerminalReleaseContext = { schema: 'temperance.migration.terminal-release.v1', authorization_id: 'owner.fixture.release', plan_digest: f.plan.plan_digest, review_digest: migrationReviewDigest(packet.review), txid: f.operation.txid, claim_nonce: f.operation.claim_nonce, lifecycle_state_root: f.state, evidence_digest: migrationReleaseEvidenceDigest(evidence), issued_at: '2026-10-03T00:00:00Z', expires_at: '2026-10-04T00:00:00Z' };
            const retained = canonical(release), retainedEvidence = canonical(evidence), resolve = ports.recovery!.resolveOperation;
            ports.recovery!.resolveOperation = async (...args) => ({ ...await resolve(...args), release_context: structuredClone(release) });
            io.now = () => new Date('2026-10-03T00:00:01Z');
            ports.recovery!.authority.authorize = async (request) => { const permitted = request.action === 'release' && canonical(request.review) === canonical(packet.review) && canonical(request.release_context) === retained && (!request.release_evidence || canonical(request.release_evidence) === retainedEvidence); return { authorized: permitted, release_authorized: permitted, owned_step_ids: f.plan.steps.map(s => s.id), lifecycle_state_root: f.state, remote_outcome: 'none' }; };
            const result = await controller.dispatch(f.request('release'));
            expect(result.exitCode).toBe(0);
            const rows = migrationReviewRows(result.view), old = rows.find(r => r.id === 'review:historical')!, current = rows.find(r => r.id === 'review:release')!;
            expect(old.lines.join('\n')).toContain('2026-10-02T00:00:00Z');
            expect(current.lines.join('\n')).toContain('2026-10-04T00:00:00Z');
            expect(current.lines.join('\n')).toContain(release.evidence_digest);
            expect(current.lines.join('\n')).toContain('not-assessed');
            expect(rows.flatMap(r => r.lines).join('\n')).not.toContain(release.authorization_id);
            ports.recovery!.authority.authorize = async () => ({ authorized: false, owned_step_ids: [], lifecycle_state_root: f.state, remote_outcome: 'unknown' });
            const unknown = await controller.dispatch(f.request('resume'));
            expect(unknown.exitCode).toBe(2);
            const recovery = migrationRows(unknown.view, 'Recovery').flatMap(r => r.lines).join('\n');
            expect(recovery).toContain(unknown.view.operation!.status);
            expect(recovery).toContain('historical');
            expect(recovery).toContain('UNKNOWN');
            expect(unknown.view.execution_authorized).toBe(false);
        }
        finally {
            await fs.rm(f.root, { recursive: true, force: true });
        }
    });
test('actual pinned factory and cleanup stream exceptions cannot leak private diagnostics', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'migration-tui-native-fault-'));
    try {
        await fs.symlink(join(import.meta.dir, '../node_modules'), join(root, 'node_modules'));
        const build = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/migration/tui.ts'), join(import.meta.dir, '../src/migration/controller.ts')], outdir: root, target: 'bun', packages: 'external' });
        expect(build.success).toBe(true);
        await fs.writeFile(join(root, 'fault.js'), `
      import {PassThrough} from 'node:stream';
      import {createCliRenderer} from '@opentui/core';
      import {runMigrationTui} from './tui.js';
      import {createMigrationController} from './controller.js';
      const mode=process.argv[2],input=new PassThrough(),output=new PassThrough();let faults=0;
      input.setRawMode=(raw)=>{if(mode==='setup'||mode==='raw'&&!raw){faults++;throw new Error('/private/CANARY-INPUT\\x1b[31m');}return input;};
      if(mode==='pause')input.pause=()=>{faults++;throw new Error('/private/CANARY-PAUSE');};
      output.columns=80;output.rows=24;output.on('data',()=>{});
      if(mode==='output')output.write=()=>{faults++;throw new Error('/private/CANARY-OUTPUT');};
      const controller=createMigrationController();
      const result=await runMigrationTui(controller,{stdin:input,stdout:output,createRenderer:async config=>{const renderer=await createCliRenderer(config);setTimeout(()=>input.emit('end'),10);return renderer;}});
      process.stdout.write(JSON.stringify({result,faults})+'\\n');
    `);
        for (const mode of ['setup', 'raw', 'pause', 'output']) {
            const child = Bun.spawn([process.execPath, '--no-env-file', '--config=/dev/null', join(root, 'fault.js'), mode], { cwd: root, env: { HOME: root, PATH: '/usr/bin:/bin', TMPDIR: root, TEMPERANCE_ALLOW_LIVE_INSPECTION: '0', DO_NOT_TRACK: '1' }, stdout: 'pipe', stderr: 'pipe' });
            const timer = setTimeout(() => child.kill('SIGTERM'), 5000);
            try {
                const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
                expect(status, err).toBe(0);
                expect(out + err).not.toContain('CANARY');
                expect(out + err).not.toContain('/private/');
                expect(out + err).not.toContain('at ');
                const observed = JSON.parse(out);
                expect(observed.faults).toBeGreaterThan(0);
                expect(observed.result.presentation).toBe('NATIVE_TUI_UNAVAILABLE');
                expect(validateMigrationView(observed.result.view)).toBe(true);
            }
            finally {
                clearTimeout(timer);
            }
        }
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}, 30000);

import type { Stats } from 'node:fs';
import { dirname } from 'node:path';
/** In-memory atomic map model ONLY. No native adapter, disk durability or host proof. */
function confirmationMemoryIO() {
  interface Entry {dir:boolean;body:string;mode:number;ino:number;clock:number}
  const entries=new Map<string,Entry>();let tick=0,ino=0,writes=0;
  const err=(code:string):never=>{throw Object.assign(new Error('private-error'),{code});};
  const put=(p:string,dir:boolean,body='',mode=dir?0o700:0o600)=>{entries.set(p,{dir,body,mode,ino:++ino,clock:++tick});};
  const entry=(p:string)=>entries.get(p)??err('ENOENT');
  put('/',true);put('/fixture',true);put('/fixture/state',true);put('/fixture/home',true);put('/fixture/home/config',true);
  const rename=(a:string,b:string,exclusive:boolean)=>{const source=entry(a);if(exclusive&&entries.has(b))err('EEXIST');entry(dirname(b));const moved=[...entries].filter(([p])=>p===a||p.startsWith(a+'/'));entries.delete(b);for(const [p]of moved)entries.delete(p);for(const [p,e]of moved)entries.set(b+p.slice(a.length),e);writes++;};
  const io:LifecycleIO={
    mkdir:async(p,o)=>{if(entries.has(p)){if(o.recursive&&entry(p).dir)return;err('EEXIST');}if(!entries.has(dirname(p))){if(!o.recursive)err('ENOENT');await io.mkdir(dirname(p),o);}put(p,true);writes++;},
    writeFile:async(p,d)=>{entry(dirname(p));put(p,false,d);writes++;},
    writeFileAtomic:async(p,d,o)=>{entry(dirname(p));put(p,false,d,o?.mode??0o600);writes++;},
    readFile:async p=>{const e=entry(p);if(e.dir)err('EISDIR');return e.body;},
    readdir:async p=>{entry(p);return [...entries.keys()].filter(k=>k!==p&&dirname(k)===p).map(k=>k.slice(p.length+1));},
    rm:async(p,o)=>{if(!entries.has(p)){if(o.force)return;err('ENOENT');}const children=[...entries.keys()].filter(k=>k.startsWith(p+'/'));if(children.length&&!o.recursive)err('ENOTEMPTY');for(const k of children)entries.delete(k);entries.delete(p);writes++;},
    lstat:async p=>{const e=entry(p);return {dev:1,ino:e.ino,mode:(e.dir?0o040000:0o100000)|e.mode,nlink:1,size:Buffer.byteLength(e.body),mtimeMs:e.clock,ctimeMs:e.clock,isFile:()=>!e.dir,isDirectory:()=>e.dir,isSymbolicLink:()=>false} as Stats;},
    chmod:async(p,m)=>{const e=entry(p);e.mode=m;e.clock=++tick;writes++;},
    rename:async(a,b)=>rename(a,b,false),renameNoReplace:async(a,b)=>rename(a,b,true),realpath:async p=>{entry(p);return p;},now:()=>new Date('2026-10-01T00:00:04Z'),
    fetch:async()=>{throw new Error('NETWORK_FORBIDDEN');},execFile:async()=>{throw new Error('EXEC_FORBIDDEN');},
  };
  return {io,entries,writes:()=>writes};
}
async function confirmationOwnerFixture(profile:'workstation'|'always-on-node'='workstation') {
  const disk=confirmationMemoryIO(),input=fixture(profile),output='owned-after\n',prior='owned-before\n';
  input.private_binding.variables.STATE_ROOT='/fixture/home';
  const requirement=input.module_bindings[0]!.destinations[0]!;
  requirement.prepared_digest=`sha256:${sha256(output)}`;
  requirement.preimage_digest=migrationPreimageDigest(sha256(prior),0o640) as `sha256:${string}`;
  await disk.io.writeFileAtomic('/fixture/home/config/fixture.json',prior,{mode:0o640});
  Object.assign(input.source_context,calculateMigrationInputDigests(input));
  const pinned=structuredClone(input.source_context); // Independently fixed before proposal.
  const plan=await createMigrationPlan(input);expect(plan.holds).toEqual([]);
  const {pinned_at:_p,expires_at:_e,...bindings}=pinned;
  let review:MigrationPlanReviewContext={...bindings,plan_digest:plan.plan_digest,reviewed_at:'2026-10-01T00:00:03Z',expires_at:'2026-10-02T00:00:00Z'};
  const operation={txid:'123456789abc-12345678',claim_nonce:'a'.repeat(32)};
  const issuedPlan=canonical(plan),issuedReview=canonical(review),issuedOperation=canonical(operation);
  let authorizations=0,finalReviews=0,allowed=true,remote:'none'|'unknown'='none';
  const ports:MigrationOwnerPorts={
    sourceContext:{readPinnedContext:async()=>structuredClone(pinned)},planning:{readInputs:async()=>{const {source_context:_s,...rest}=input;return structuredClone(rest);}},
    finalReview:{readFinalReview:async()=>{finalReviews++;return structuredClone(review);}},
    recovery:{resolveOperation:async request=>({operation,plan,stateRoot:'/fixture/state',io:disk.io,root_tokens:{STATE_ROOT:'HOME'},...(request.action==='apply'?{prepared:new Map(plan.steps.map(s=>[s.id,output]))}:{})}),
      authority:{authorize:async request=>{authorizations++;return {authorized:allowed&&canonical(request.plan)===issuedPlan&&canonical(request.review)===issuedReview&&canonical(request.operation)===issuedOperation,owned_step_ids:plan.steps.map(s=>s.id),lifecycle_state_root:'/fixture/state',remote_outcome:remote};},readFreshInputs:async io=>{const root=await io.lstat('/fixture/home');if(!root.isDirectory()||root.isSymbolicLink())throw new Error('ROOT_DRIFT');const {source_context:_s,...rest}=input;return structuredClone(rest);}}},
  };
  const request=(action:'apply'|'resume'|'rollback'|'release'|'status'):MigrationRequest=>action==='apply'?{action,plan:'approved-plan',reviewed_digest:plan.plan_digest}:action==='status'?{action,operation:operation.txid}:{action,operation:operation.txid,reviewed_digest:plan.plan_digest};
  return {disk,input,plan,ports,request,operation,output,prior,counts:()=>({authorizations,finalReviews}),deny:()=>{allowed=false;},unknown:()=>{remote='unknown';},review:(r:MigrationPlanReviewContext)=>{review=r;},getReview:()=>structuredClone(review)};
}

async function confirmationUi(profile:'workstation'|'always-on-node') {
 const f=await confirmationOwnerFixture(profile),controller=createMigrationController({ports:f.ports});await controller.dispatch({action:'plan',profile});
 const ui=await createTestRenderer({width:120,height:40}),{runMigrationTui}=await implementation(),run=runMigrationTui(controller,{createRenderer:async()=>ui.renderer});await ui.waitForFrame(frame=>frame.includes('Migration | Ecosystem'));
 const open=async(action:'apply'|'resume')=>{ui.mockInput.pressKey(action==='resume'?'[':'a');await ui.waitForFrame(frame=>frame.includes(action==='resume'?'Migration | Recovery':'Migration | Actions'));await ui.mockInput.pressKeys(Array(action==='resume'?2:4).fill('ARROW_DOWN'));ui.mockInput.pressEnter();if(action==='apply'){await ui.waitForFrame(frame=>frame.includes('Input required: plan'));await ui.mockInput.typeText('approved-plan');ui.mockInput.pressEnter();}await ui.waitForFrame(frame=>frame.includes('REQUEST this exact action'));};
 const close=async()=>{if(!ui.renderer.isDestroyed)ui.mockInput.pressCtrlC();await ui.flush();await run;ui.renderer.destroy();};return {f,controller,ui,run,open,close};
}
for(const profile of ['workstation','always-on-node'] as const){
 test(`${profile}: confirmation survives nested Help and Review then explicit back without effects`,async()=>{
  const x=await confirmationUi(profile);try{await x.open('apply');const before=x.f.disk.writes();for(const key of ['?','r']){x.ui.mockInput.pressKey(key);await x.ui.waitForFrame(frame=>frame.includes(key==='?'?'Migration | Help':'Migration | Review'));x.ui.mockInput.pressEscape();await x.ui.flush();expect(x.ui.renderer.isDestroyed).toBe(false);expect(x.ui.captureCharFrame()).toContain('REQUEST this exact action');}x.ui.mockInput.pressEscape();await x.ui.waitForFrame(frame=>frame.includes('Migration | Actions'));expect(x.f.disk.writes()).toBe(before);expect(x.f.counts().authorizations).toBe(0);}finally{await x.close();}
 });
 test(`${profile}: direct Recovery Resume displays full exact review and unknown rollback observations`,async()=>{
  const x=await confirmationUi(profile);try{await x.controller.dispatch(x.f.request('apply'));const before=x.f.disk.writes();await x.open('resume');const detail=x.ui.renderer.root.findDescendantById('migration-detail-text') as import('@opentui/core').TextRenderable|undefined;const text=detail!.chunks.map(chunk=>chunk.text).join('');expect(text.replaceAll('\n','')).toContain(x.f.plan.source_release_digest);expect(text).toContain('Backup availability: UNKNOWN');expect(text).toContain('Preimage availability: UNKNOWN');expect(text).toContain('exclusive-owned-claim');expect(text).toContain('Historical final work review');expect(text).toContain('Current terminal release context');x.ui.mockInput.pressKey('END');await x.ui.flush();expect(x.ui.captureCharFrame()).toContain('Backup availability: UNKNOWN');expect(x.f.disk.writes()).toBe(before);}finally{await x.close();}
 });
 for(const change of ['plan','profile','operation','review'] as const)test(`${profile}: enabled ${change} drift invalidates retained consent before owner dispatch`,async()=>{
  const x=await confirmationUi(profile);try{
   if(change==='operation'){await x.controller.dispatch(x.f.request('apply'));await x.open('resume');}else await x.open('apply');
   const before=x.f.disk.writes(),authorizations=x.f.counts().authorizations;
   if(change==='plan'){const b=structuredClone(x.f.input);b.module_bindings[0]!.version='2.0.0';Object.assign(b.source_context,calculateMigrationInputDigests(b));x.f.ports.sourceContext!.readPinnedContext=async()=>structuredClone(b.source_context);x.f.ports.planning!.readInputs=async()=>structuredClone(b);await x.controller.dispatch({action:'plan',profile});expect(x.controller.view().plan!.plan_digest).not.toBe(x.f.plan.plan_digest);}
   else if(change==='profile')await x.controller.dispatch({action:'select-profile',profile:profile==='workstation'?'always-on-node':'workstation'});
   else if(change==='operation'){const resolve=x.f.ports.recovery!.resolveOperation;x.f.ports.recovery!.resolveOperation=async(...args)=>({...await resolve(...args),operation:{txid:'abcdefabcdef-12345678',claim_nonce:'b'.repeat(32)}});await x.controller.dispatch({action:'status',operation:'abcdefabcdef-12345678'});}
   else {const review=x.f.getReview();review.reviewed_at='2026-10-01T00:00:03.500Z';x.f.review(review);await x.controller.dispatch(x.f.request('status'));}
   const settledWrites=x.f.disk.writes(),settledAuthorizations=x.f.counts().authorizations;expect(x.controller.view().actions.find(a=>a.id===(change==='operation'?'resume':'apply'))!.enabled).toBe(true);
   x.ui.mockInput.pressEnter();await x.ui.flush();expect(x.f.disk.writes()).toBe(settledWrites);expect(x.f.counts().authorizations).toBe(settledAuthorizations);expect(x.ui.renderer.isDestroyed).toBe(false);expect(x.ui.captureCharFrame()).toContain('Review changed');expect(x.ui.captureCharFrame()).not.toContain('REQUEST this exact action');
   if(change==='plan'||change==='profile'){expect(settledWrites).toBe(before);expect(settledAuthorizations).toBe(authorizations);}
  }finally{await x.close();}
 });
}
