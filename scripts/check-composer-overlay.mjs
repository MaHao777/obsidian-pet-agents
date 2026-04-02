import { execFileSync } from "node:child_process";

const evalCode = `
(async () => {
  const toggle = document.querySelector('.pet-agents-composer-toggle');
  const composer = document.querySelector('.pet-agents-composer');
  const inputShell = document.querySelector('.pet-agents-input-shell');
  const panel = document.querySelector('.pet-agents-settings-panel');
  const view = document.querySelector('.workspace-leaf-content[data-type="obs-pet-agents-view"] > .view-content.pet-agents-view');

  if (!toggle || !composer || !inputShell || !panel || !view) {
    return { ok: false, reason: 'missing-elements' };
  }

  const wasExpanded = panel.classList.contains('is-expanded');
  if (!wasExpanded) {
    toggle.click();
    await new Promise((resolve) => window.setTimeout(resolve, 280));
  }

  const composerRect = composer.getBoundingClientRect();
  const inputRect = inputShell.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const viewRect = view.getBoundingClientRect();
  const viewStyle = getComputedStyle(view);

  if (!wasExpanded) {
    toggle.click();
  }

  return {
    ok:
      composerRect.height <= inputRect.height + 20 &&
      panelRect.bottom <= inputRect.top - 4 &&
      parseInt(viewStyle.paddingBottom, 10) <= 4 &&
      Math.round(viewRect.bottom - inputRect.bottom) <= 12,
    wasExpanded,
    composerHeight: Math.round(composerRect.height),
    inputHeight: Math.round(inputRect.height),
    panelTop: Math.round(panelRect.top),
    panelBottom: Math.round(panelRect.bottom),
    inputTop: Math.round(inputRect.top),
    viewPaddingBottom: viewStyle.paddingBottom,
    inputToViewBottom: Math.round(viewRect.bottom - inputRect.bottom),
  };
})()
`;

const raw = execFileSync("obsidian", ["eval", `code=${evalCode}`, "vault=Note"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();

const json = raw.replace(/^=>\s*/, "");
const result = JSON.parse(json);

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
