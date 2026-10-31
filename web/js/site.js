import { thumbnail } from "./SiteThumb.js";
import { loadSettings } from "./Settings.js";
const $ = (id) => document.getElementById(id);
let account = null,
  page = 1,
  total = 0,
  catalogSerial = 0,
  boardSerial = 0;
const known = new Map();
const message = (id, text, error = false) => {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("error", error);
};
async function api(path, body, method) {
  const r = await fetch("/api/" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok || !result.success) {
    const e = Error(result.error || "Ошибка сервера");
    e.status = r.status;
    throw e;
  }
  return result.data;
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function link(text, href, cls = "button secondary small") {
  const el = node("a", text, cls);
  el.href = href;
  return el;
}
const time = (s) =>
  `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
const race = (id) =>
  "play.html?" +
  new URLSearchParams({
    ...(id && { circuit: id }),
    season: loadSettings().season || "summer",
  });
function emptyRow(body, text, columns) {
  const row = node("tr"),
    cell = node("td", text);
  cell.colSpan = columns;
  row.append(cell);
  body.append(row);
}
function remember(c) {
  if (known.has(c.id)) return;
  known.set(c.id, c);
  const option = node("option", c.name);
  option.value = c.id;
  $("board-track").append(option);
}
function trackCard(c) {
  const card = node("article", undefined, "track"),
    visual = node("a", undefined, "track-visual");
  visual.href = race(c.id);
  visual.setAttribute("aria-label", "Заезд: " + c.name);
  visual.append(thumbnail(c.shape));
  const content = node("div", undefined, "track-content"),
    actions = node("div", undefined, "actions"),
    star = node(
      "button",
      (c.starred ? "★ " : "☆ ") + c.stars,
      "button secondary small",
    );
  star.type = "button";
  star.setAttribute("aria-label", "Отметить трассу " + c.name);
  star.setAttribute("aria-pressed", String(!!c.starred));
  star.onclick = async () => {
    if (!account) {
      location.href = "login.html?next=%2Fsite.html%23catalog";
      return;
    }
    star.disabled = true;
    try {
      const data = await api("circuits/" + c.id + "/star", {});
      c.starred = data.starred;
      c.stars = data.stars;
      star.textContent = (c.starred ? "★ " : "☆ ") + c.stars;
      star.setAttribute("aria-pressed", String(c.starred));
    } catch (e) {
      message("catalog-status", e.message, true);
    } finally {
      star.disabled = false;
    }
  };
  actions.append(link("Заезд ↗", race(c.id), "button small"), star);
  const board = node("button", "Рейтинг", "button secondary small");
  board.type = "button";
  board.onclick = () => {
    $("board-track").value = c.id;
    loadBoard();
    location.hash = "leaderboard";
  };
  actions.append(board);
  if (c.mine) {
    const remove = node("button", "Удалить", "button secondary small");
    remove.type = "button";
    let armed = false;
    remove.onclick = async () => {
      if (!armed) {
        armed = true;
        remove.textContent = "Подтвердить удаление";
        setTimeout(() => {
          armed = false;
          remove.textContent = "Удалить";
        }, 5000);
        return;
      }
      remove.disabled = true;
      try {
        await api("circuits/" + c.id, undefined, "DELETE");
        await Promise.all([loadCatalog(), loadProfile()]);
      } catch (e) {
        message("catalog-status", e.message, true);
        remove.disabled = false;
      }
    };
    actions.append(remove);
  }
  content.append(
    node("h3", c.name),
    node("p", c.mine ? "Твоя трасса" : "Автор: " + c.author),
    actions,
  );
  card.append(visual, content);
  return card;
}
async function loadCatalog() {
  const serial = ++catalogSerial;
  $("prev").disabled = $("next").disabled = true;
  message("catalog-status", "Загружаем трассы…");
  try {
    const data = await api(
      "circuits?" +
        new URLSearchParams({
          page,
          limit: 12,
          ...($("mine").checked && { mine: 1 }),
        }),
    );
    if (serial !== catalogSerial) return;
    total = data.total;
    $("tracks").replaceChildren(
      ...data.circuits.map((c) => {
        remember(c);
        return trackCard(c);
      }),
    );
    message(
      "catalog-status",
      total
        ? `${total} трасс в каталоге`
        : "Пока нет опубликованных трасс. Создай первую в редакторе.",
    );
    $("page-number").textContent =
      `${page} / ${Math.max(1, Math.ceil(total / 12))}`;
    $("prev").disabled = page <= 1;
    $("next").disabled = page * 12 >= total;
  } catch (e) {
    if (serial !== catalogSerial) return;
    $("tracks").replaceChildren();
    message(
      "catalog-status",
      e.status === 401
        ? "Для просмотра своих трасс войди в аккаунт."
        : "Не удалось загрузить каталог: " + e.message,
      true,
    );
  }
}
async function loadBoard() {
  const serial = ++boardSerial;
  message("board-status", "Загружаем результаты…");
  $("board-rows").replaceChildren();
  try {
    const data = await api("tracks/" + $("board-track").value + "/leaderboard");
    if (serial !== boardSerial) return;
    message(
      "board-status",
      data.total
        ? `${data.total} пилотов · личный лучший круг каждого`
        : "На этой трассе ещё нет результатов. Стань первым!",
    );
    data.entries.forEach((entry, i) => {
      const row = node("tr");
      row.append(
        node("td", i + 1),
        node("td", entry.name),
        node("td", time(entry.time)),
        node("td", entry.car),
      );
      $("board-rows").append(row);
    });
    if (!data.entries.length)
      emptyRow($("board-rows"), "Трасса ждёт первого рекорда", 4);
  } catch (e) {
    if (serial === boardSerial)
      message(
        "board-status",
        "Не удалось загрузить рейтинг: " + e.message,
        true,
      );
  }
}
async function loadProfile() {
  try {
    const data = await api("me/dashboard");
    account = data.account;
    $("member").hidden = false;
    $("guest").hidden = true;
    $("logout").hidden = false;
    $("nickname").value = account.pseudo;
    $("account-link").textContent = account.pseudo || "Личный кабинет";
    message("profile-status", "Аккаунт: " + account.username);
    for (const key of ["circuits", "records", "stars"])
      $("stat-" + key).textContent = data.stats[key];
    $("personal-rows").replaceChildren();
    for (const result of data.results) {
      const row = node("tr"),
        name = node("td");
      if (result.circuit || result.track === "default")
        name.append(link(result.name, race(result.circuit), ""));
      else name.textContent = result.name;
      const date = new Date(result.date);
      row.append(
        name,
        node("td", time(result.time)),
        node("td", "#" + result.rank),
        node(
          "td",
          Number.isNaN(+date) ? "—" : date.toLocaleDateString("ru-RU"),
        ),
      );
      $("personal-rows").append(row);
    }
    if (!data.results.length)
      emptyRow(
        $("personal-rows"),
        "Заверши круг, чтобы сохранить свой первый результат",
        4,
      );
  } catch (e) {
    if (e.status === 401) {
      account = null;
      $("member").hidden = true;
      $("guest").hidden = false;
      $("logout").hidden = true;
      message("profile-status", "");
    } else
      message(
        "profile-status",
        "Профиль временно недоступен: " + e.message,
        true,
      );
  }
}
$("nickname-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("me/pseudo", { pseudo: $("nickname").value });
    account.pseudo = data.pseudo;
    $("account-link").textContent = data.pseudo;
    message("nickname-status", "Имя сохранено");
  } catch (e) {
    message("nickname-status", e.message, true);
  } finally {
    button.disabled = false;
  }
};
$("logout").onclick = async () => {
  try {
    await api("auth/sign-out", {});
    location.reload();
  } catch (e) {
    message("profile-status", e.message, true);
  }
};
$("mine").onchange = () => {
  page = 1;
  loadCatalog();
};
$("my-tracks").onclick = () => {
  $("mine").checked = true;
  page = 1;
  loadCatalog();
  location.hash = "catalog";
};
$("prev").onclick = () => {
  if (page > 1) {
    page--;
    loadCatalog();
  }
};
$("next").onclick = () => {
  if (page * 12 < total) {
    page++;
    loadCatalog();
  }
};
$("board-track").onchange = loadBoard;
await loadProfile();
await Promise.all([loadCatalog(), loadBoard()]);
