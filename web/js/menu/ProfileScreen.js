import { request } from "../Leaderboard.js";
import { setPseudo, signIn } from "../Account.js";
import { unpublishCircuit } from "../Circuits.js";
import { formatTime } from "../Settings.js";
import { publishedCircuitName } from "../multi/Protocol.js";
import { t } from "../i18n.js";

// The account uses the same panels, tabs and showroom framing as Settings.
// Data is fetched only on entering this screen or explicitly refreshing it.
export function createProfileScreen({
  escapeHtml: esc,
  onChange,
  onName,
  onBeta,
  onPlay,
  onSignOut,
  onCircuits,
}) {
  let data = null,
    tracks = null,
    error = "",
    pending = false,
    tab = "profile",
    page = 1;
  const label = (key) => t("profileMenu." + key);
  const validTrack = (id) => id === "default" || /^[a-f0-9]{64}$/.test(id);
  async function load() {
    if (pending) return;
    pending = true;
    const [dashboard, published] = await Promise.all([
      request("me/dashboard"),
      request(`circuits?mine=1&limit=8&page=${page}`),
    ]);
    pending = false;
    if (dashboard.status === 401) { await signIn(); return; }
    data = dashboard.ok ? dashboard.data : null;
    tracks = published.ok ? published.data : null;
    error = !dashboard.ok
      ? dashboard.error
      : !published.ok
        ? published.error
        : "";
    onChange();
  }
  function invalidate() {
    data = tracks = null;
    error = "";
  }
  function profileBody() {
    return (
      `<div class="account-card"><b>${esc(data.account.username)}</b><div class="account-stats">${["circuits", "records", "stars"].map((key) => `<div><strong>${Number(data.stats[key])}</strong><small>${label(key)}</small></div>`).join("")}</div></div>` +
      `<form id="account-name-form" class="account-card"><label for="account-nickname">${t("account.pseudo")}</label><div class="row"><input id="account-nickname" autocomplete="nickname" required maxlength="20" value="${esc(data.account.pseudo)}"><button class="chip" type="submit">${label("save")}</button></div><p class="note" id="account-name-status" role="status">${t("account.pseudoNote")}</p></form>` +
      (data.account.beta ? '<div class="account-card"><b>Бета-доступ активирован</b></div>' : '<form id="beta-access-form" class="account-card"><label for="beta-code">Код бетатестера</label><div class="row"><input id="beta-code" type="password" autocomplete="off" maxlength="100" required><button class="chip" type="submit">Активировать</button></div><p role="status" class="note"></p></form>') +
      `<p class="note">${label("storage")}</p><div class="row"><button class="chip" data-account-action="refresh">${label("refresh")}</button><button class="chip" data-account-action="sign-out">${t("account.signOut")}</button></div>`
    );
  }
  function recordsBody() {
    return (
      `<p class="note">${label("recordsNote")}</p>` +
      (data.results.length
        ? data.results
            .map((r) => {
              const id = r.circuit || r.track,
                canPlay = validTrack(id);
              return `<article class="account-card account-record"><div><b>${esc(publishedCircuitName(id, r.name))}</b><small>${esc(r.car)} · #${Number(r.rank)}</small></div><strong>${formatTime(r.time)}</strong>${canPlay ? `<button class="chip" data-account-play="${id}">${label("drive")}</button>` : ""}</article>`;
            })
            .join("")
        : `<p class="note">${label("noRecords")}</p>`)
    );
  }
  function tracksBody() {
    return (
      (tracks?.circuits.length
        ? tracks.circuits
            .map(
              (c) =>
                `<article class="account-card"><b>${esc(c.name)}</b><small>★ ${Number(c.stars)}</small><div class="row"><button class="chip" data-account-play="${esc(c.id)}">${label("drive")}</button><button class="chip" data-account-delete="${esc(c.id)}">${label("remove")}</button></div></article>`,
            )
            .join("")
        : `<p class="note">${label("noTracks")}</p>`) +
      `<div class="row"><button class="chip" data-account-page="-1" ${page <= 1 ? "disabled" : ""}>‹</button><span class="note">${page} / ${Math.max(1, Math.ceil((tracks?.total || 0) / 8))}</span><button class="chip" data-account-page="1" ${page * 8 >= (tracks?.total || 0) ? "disabled" : ""}>›</button></div>` +
      `<div class="row"><button class="chip" data-act="editor">${label("editor")}</button><button class="chip" data-account-action="catalog">${label("catalog")}</button></div>`
    );
  }
  function after() {
    const panel = document.getElementById("account-panel");
    if (!panel) return;
    panel.onclick = async (e) => {
      const button = e.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.accountTab) {
        tab = button.dataset.accountTab;
        onChange();
      } else if (
        button.dataset.accountPlay &&
        validTrack(button.dataset.accountPlay)
      )
        onPlay(button.dataset.accountPlay);
      else if (button.dataset.accountPage) {
        page += Number(button.dataset.accountPage);
        invalidate();
        onChange();
      } else if (button.dataset.accountDelete) {
        if (!button.dataset.confirmed) {
          button.dataset.confirmed = "yes";
          button.textContent = label("confirmRemove");
          return;
        }
        button.disabled = true;
        const result = await unpublishCircuit(button.dataset.accountDelete);
        if (result.ok) {
          page = 1;
          invalidate();
          onChange();
        } else {
          error = result.error;
          onChange();
        }
      } else if (button.dataset.accountAction === "refresh") {
        invalidate();
        onChange();
      } else if (button.dataset.accountAction === "sign-out") {
        button.disabled = true;
        onSignOut();
      } else if (button.dataset.accountAction === "catalog") onCircuits();
    };
    const betaForm = panel.querySelector('#beta-access-form');
    if(betaForm) betaForm.onsubmit=async e=>{
      e.preventDefault(); const button=betaForm.querySelector('button'); button.disabled=true;
      const result=await request('me/beta',{method:'POST',body:JSON.stringify({code:betaForm.querySelector('input').value})});
      if(result.ok){ data.account.beta=true; await onBeta(); onChange(); }
      else { betaForm.querySelector('[role=status]').textContent=result.error; button.disabled=false; }
    };
    const form = panel.querySelector("#account-name-form");
    if (form)
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector("button"),
          status = form.querySelector("[role=status]");
        button.disabled = true;
        const result = await setPseudo(
          form
            .querySelector("input")
            .value.normalize("NFKC")
            .trim()
            .replace(/\s+/g, " "),
        );
        button.disabled = false;
        status.textContent = result.ok ? label("saved") : result.error;
        if (result.ok) {
          data.account.pseudo = result.data.pseudo;
          onName(result.data.pseudo);
        }
      };
    if (!data && !error) load();
  }
  function screen() {
    const content = !data
      ? `<p class="note" role="status">${error ? esc(error) : label("loading")}</p><button class="chip" data-account-action="refresh">${label("refresh")}</button>`
      : (error ? `<p class="note" role="status">${esc(error)}</p>` : "") +
        (tab === "profile"
          ? profileBody()
          : tab === "records"
            ? recordsBody()
            : tracksBody());
    return {
      view: "menu",
      title: label("title"),
      html: `<section id="account-panel" class="panel settings-panel account-panel" aria-label="${label("title")}"><div class="tabs">${["profile", "records", "tracks"].map((key) => `<button data-account-tab="${key}" class="${key === tab ? "on" : ""}">${label(key)}</button>`).join("")}</div><div class="tab-body">${content}</div></section>`,
      after,
    };
  }
  return { screen, invalidate };
}
