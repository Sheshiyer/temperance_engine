import { BoxRenderable, CliRenderEvents, SelectRenderable, TextRenderable, createCliRenderer, type CliRenderer } from "@opentui/core";

/** Read-only inspection panel. Closing it returns to the same wizard step. */
export async function runOperatorReportTui(title: string, report: string, options: { renderer?: CliRenderer } = {}): Promise<void> {
  const renderer = options.renderer ?? await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const width = Math.max(16, renderer.width - 6);
  const lines = report.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "�").split("\n").flatMap(line => {
    const chars = Array.from(line);
    return chars.length ? Array.from({ length: Math.ceil(chars.length / width) }, (_, index) => chars.slice(index * width, (index + 1) * width).join("")) : [" "];
  });
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%", padding: 1, flexDirection: "column", backgroundColor: "#0b1020" });
  root.add(new TextRenderable(renderer, { height: 2, flexShrink: 0, content: `Temperance · ${title}\nRead-only observation; no repair or activation performed.`, fg: "#d8dee9" }));
  const rows = new SelectRenderable(renderer, { id: "operator-report", width: "100%", flexGrow: 1, minHeight: 3, showDescription: false, showScrollIndicator: true, wrapSelection: false, options: lines.map(name => ({ name, description: "", value: "detail" })) });
  root.add(rows);
  root.add(new TextRenderable(renderer, { height: 2, flexShrink: 0, content: "↑/↓ scroll · PgUp/PgDn page · Home/End\nEnter/Esc/q returns to setup with your choices preserved", fg: "#88c0d0" }));
  renderer.root.add(root); rows.focus(); renderer.start();
  await new Promise<void>(resolve => {
    let closed = false;
    const finish = (): void => { if (closed) return; closed = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (!closed) { closed = true; resolve(); } });
    renderer.keyInput.on("keypress", key => {
      if (["enter", "return", "escape", "q"].includes(key.name)) finish();
      else if (key.name === "home") rows.setSelectedIndex(0);
      else if (key.name === "end") rows.setSelectedIndex(rows.options.length - 1);
      else if (key.name === "pageup") rows.moveUp(Math.max(1, renderer.height - 7));
      else if (key.name === "pagedown") rows.moveDown(Math.max(1, renderer.height - 7));
    });
  });
}
