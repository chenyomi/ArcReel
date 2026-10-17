const screen = document.querySelector("#screen");
const title = document.querySelector("#title");
const tabs = document.querySelector("#tabs");
const state = {
  view: "home",
  site: null,
  categories: [],
  products: [],
  categoryId: 0,
  query: "",
  detail: null,
  shot: 0,
};

const TAB_TITLES = { home: "新弹力", cats: "分类", latest: "上新", contact: "联系", about: "介绍" };
const TAB_LABELS = { home: "首页", cats: "分类", latest: "上新", contact: "联系", about: "介绍" };

boot();
window.addEventListener("hashchange", () => {
  applyHash();
  render();
});

async function boot() {
  const [site, categories, products] = await Promise.all([
    get("/site"),
    get("/categories"),
    get("/products?limit=80"),
  ]);
  state.site = site.site;
  state.categories = categories.categories;
  state.products = products.products;
  applyHash();
  render();
}

function applyHash() {
  const hash = location.hash.replace(/^#/, "");
  if (hash.startsWith("detail/")) {
    const id = Number(hash.split("/")[1]);
    state.detail = state.products.find((product) => product.id === id) || null;
    state.shot = 0;
    return;
  }
  if (TAB_TITLES[hash]) {
    state.view = hash;
    state.detail = null;
  }
}

async function get(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("加载失败");
  return response.json();
}

function render() {
  title.textContent = state.detail ? "详情" : TAB_TITLES[state.view];
  tabs.hidden = Boolean(state.detail);
  tabs.innerHTML = ["home", "cats", "latest", "contact", "about"]
    .map((name) => `<button type="button" data-view="${name}" class="${!state.detail && state.view === name ? "on" : ""}">${TAB_LABELS[name]}</button>`)
    .join("");
  tabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = button.dataset.view;
    });
  });
  screen.innerHTML = state.detail ? detailView() : ({
    home: homeView,
    cats: catsView,
    latest: latestView,
    contact: contactView,
    about: aboutView,
  })[state.view]();
  bind();
  screen.scrollTop = 0;
}

function homeView() {
  const site = state.site;
  const newest = [...state.products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  return `<section class="fascia">
      ${site.heroImage ? `<img alt="" src="${esc(site.heroImage)}" />` : ""}
      <div class="shade"></div>
      <div class="copy"><span class="mark">SNB</span><h1>新弹力鞋业</h1><span class="tag">${esc(site.tagline)}</span></div>
    </section>
    <div class="rule"></div>
    <p class="kicker">当季</p>
    ${newest.length ? `<div class="grid">${newest.map(card).join("")}</div>` : '<p class="empty">这一季的款还没放上来。</p>'}
    <p class="kicker">合作电话</p>
    <div class="phones">${phoneRow(site.phone1)}${phoneRow(site.phone2)}</div>`;
}

function catsView() {
  const rail = [{ id: 0, name: "全部" }, ...state.categories]
    .map((category) => `<button type="button" data-cat="${category.id}" class="${state.categoryId === category.id ? "on" : ""}">${esc(category.name)}</button>`)
    .join("");
  const query = state.query.trim().toLowerCase();
  const rows = state.products.filter((product) => {
    const inCategory = state.categoryId === 0 || product.categoryId === state.categoryId;
    return inCategory && (!query || product.code.toLowerCase().includes(query));
  });
  return `<input class="search" id="query" placeholder="货号" value="${esc(state.query)}" />
    <div class="finder">
      <div class="rail">${rail}</div>
      <div class="results">${rows.map(line).join("") || '<p class="empty">这个分类还没有款。</p>'}</div>
    </div>`;
}

function latestView() {
  const rows = [...state.products].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `<p class="kicker">按放下的时间</p>
    <div class="stack">${rows.map(wide).join("") || '<p class="empty">还没有上新。</p>'}</div>`;
}

function contactView() {
  const site = state.site;
  const map = site.latitude != null && site.longitude != null
    ? `<a href="https://uri.amap.com/marker?position=${site.longitude},${site.latitude}&name=${encodeURIComponent(site.company)}" target="_blank" rel="noreferrer">打开导航</a>`
    : "";
  return `<section class="fascia">${site.heroImage ? `<img alt="" src="${esc(site.heroImage)}" />` : ""}<div class="shade"></div>
      <div class="copy"><span class="mark">SNB</span><h1>联系</h1></div></section>
    <div class="rule"></div>
    <div class="pad">
      <strong>${esc(site.company)}</strong>
      <p class="address">${esc(site.address)}</p>
      ${map}
    </div>
    <div class="phones">${phoneRow(site.phone1)}${phoneRow(site.phone2)}</div>`;
}

function aboutView() {
  return `<div class="pad"><span class="mark">SNB</span><h1 class="code" style="font-size:32px">${esc(state.site.company)}</h1>
    <p class="note">${esc(state.site.about)}</p></div>`;
}

function detailView() {
  const product = state.detail;
  const image = product.images[state.shot];
  const specs = [
    ["鞋底", product.sole],
    ["面料", product.upper],
    ["码段", product.sizes],
    ["装箱", product.pack],
    ["起订", product.moq],
  ].filter(([, value]) => value);
  const second = state.site.wechat || state.site.phone2;
  return `<div class="pad" style="padding-bottom:0"><button class="back" type="button" id="back">返回</button></div>
    <div class="hero">${image ? `<img alt="" src="${esc(image.url)}" />` : `<div class="code-only">${esc(product.code)}</div>`}</div>
    ${product.images.length > 1 ? `<div class="thumbs">${product.images.map((item, index) => `<button type="button" data-shot="${index}" class="${index === state.shot ? "on" : ""}"><img alt="" src="${esc(item.url)}" /></button>`).join("")}</div>` : ""}
    <div class="pad">
      <span class="meta">${esc(product.category)}</span>
      <strong class="code" style="font-size:34px">${esc(product.code)}</strong>
      <span class="meta">${product.price ? `¥${esc(product.price)}` : "询价"}</span>
    </div>
    ${specs.length ? `<dl class="specs">${specs.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : ""}
    ${product.note ? `<p class="note">${esc(product.note)}</p>` : ""}
    <div class="bar">
      <a href="tel:${digits(state.site.phone1)}">拨打 ${esc(formatPhone(state.site.phone1))}</a>
      <button type="button" id="copy">${state.site.wechat ? "复制微信" : "复制号码"}</button>
    </div>`;
}

function card(product) {
  const cover = product.images[0]?.url;
  return `<button class="card" type="button" data-id="${product.id}">
    <span class="photo">${cover ? `<img alt="" src="${esc(cover)}" />` : ""}</span>
    <span class="code">${esc(product.code)}</span>
    <span class="meta">${esc(product.category)}</span>
  </button>`;
}

function line(product) {
  const cover = product.images[0]?.url;
  return `<button class="line" type="button" data-id="${product.id}">
    <span class="photo">${cover ? `<img alt="" src="${esc(cover)}" />` : ""}</span>
    <span><strong class="code">${esc(product.code)}</strong><span class="meta">${esc(product.category)} · ${product.price ? `¥${esc(product.price)}` : "询价"}</span></span>
  </button>`;
}

function wide(product) {
  const cover = product.images[0]?.url;
  return `<button class="wide" type="button" data-id="${product.id}">
    <span class="photo">${cover ? `<img alt="" src="${esc(cover)}" />` : ""}</span>
    <span><span class="meta">${esc(product.category)}</span><strong class="code">${esc(product.code)}</strong><span class="meta">${product.price ? `¥${esc(product.price)}` : "询价"}</span></span>
  </button>`;
}

function phoneRow(number) {
  if (!number) return "";
  return `<div class="phone-row"><span>${esc(formatPhone(number))}</span><a href="tel:${digits(number)}">拨打</a></div>`;
}

function bind() {
  screen.querySelectorAll("[data-id]").forEach((node) => {
    node.addEventListener("click", () => openDetail(Number(node.dataset.id)));
  });
  screen.querySelectorAll("[data-cat]").forEach((node) => {
    node.addEventListener("click", () => {
      state.categoryId = Number(node.dataset.cat);
      render();
    });
  });
  const query = screen.querySelector("#query");
  if (query) {
    query.addEventListener("input", () => {
      state.query = query.value;
      const results = screen.querySelector(".results");
      const filtered = filterProducts();
      results.innerHTML = filtered.map(line).join("") || '<p class="empty">没有这个货号。</p>';
      results.querySelectorAll("[data-id]").forEach((node) => {
        node.addEventListener("click", () => openDetail(Number(node.dataset.id)));
      });
    });
  }
  screen.querySelectorAll("[data-shot]").forEach((node) => {
    node.addEventListener("click", () => {
      state.shot = Number(node.dataset.shot);
      render();
    });
  });
  const back = screen.querySelector("#back");
  if (back) back.addEventListener("click", () => { location.hash = state.view; });
  const copy = screen.querySelector("#copy");
  if (copy) {
    copy.addEventListener("click", async () => {
      const value = state.site.wechat || state.site.phone2;
      await navigator.clipboard.writeText(value);
      copy.textContent = "已复制";
    });
  }
}

function filterProducts() {
  const query = state.query.trim().toLowerCase();
  return state.products.filter((product) => {
    const inCategory = state.categoryId === 0 || product.categoryId === state.categoryId;
    return inCategory && (!query || product.code.toLowerCase().includes(query));
  });
}

function openDetail(id) {
  location.hash = `detail/${id}`;
}

function formatPhone(value) {
  const raw = digits(value);
  if (raw.length === 11) return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
  return value || "";
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
