const API = location.hostname === "admin.chenyomi.top" ? "https://api.chenyomi.top" : location.origin;
const app = document.querySelector("#app");
const state = {
  categories: [],
  products: [],
  site: null,
  error: "",
  notice: "",
  pending: [],
};

window.addEventListener("hashchange", draw);
boot();

async function boot() {
  if (!token()) {
    location.hash = "#/login";
    draw();
    return;
  }
  if (!location.hash || location.hash === "#/login") location.hash = "#/products";
  await refresh();
  draw();
}

function token() {
  return sessionStorage.getItem("snb_token") || "";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.json) headers["Content-Type"] = "application/json";
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(API + path, {
    method: options.method || "GET",
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionStorage.removeItem("snb_token");
    location.hash = "#/login";
    throw new Error(data.error || "请先登录");
  }
  if (!response.ok) throw new Error(data.error || "没有保存");
  return data;
}

async function refresh() {
  const [categories, products, site] = await Promise.all([
    api("/categories"),
    api("/products"),
    api("/site"),
  ]);
  state.categories = categories.categories;
  state.products = products.products;
  state.site = site.site;
}

function route() {
  const hash = location.hash || "#/login";
  const parts = hash.slice(2).split("/");
  return { name: parts[0] || "login", id: parts[1] || "" };
}

function draw() {
  const current = route();
  if (current.name === "login" || !token()) {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }
  app.innerHTML = shell(current);
  bindShell(current);
}

function loginView() {
  return `<section class="login"><form>
    <span class="mark">SNB</span>
    <h1>样本册</h1>
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" />
    <p class="error">${esc(state.error)}</p>
    <button type="submit">进入</button>
  </form></section>`;
}

function shell(current) {
  const page = current.name === "categories" ? "categories" : current.name === "site" ? "site" : "products";
  return `<header class="top">
    <div class="brand"><span class="mark">SNB</span><b>新弹力</b></div>
    <nav>
      <a href="#/products" class="${page === "products" ? "on" : ""}">款式</a>
      <a href="#/categories" class="${page === "categories" ? "on" : ""}">分类</a>
      <a href="#/site" class="${page === "site" ? "on" : ""}">联系与介绍</a>
    </nav>
    <button id="logout" type="button">退出</button>
  </header>
  <main class="wrap">${view(current)}</main>`;
}

function view(current) {
  if (current.name === "categories") return categoriesView();
  if (current.name === "site") return siteView();
  if (current.id) return editorView(current.id);
  return listView();
}

function listView() {
  const items = state.products
    .map((product) => {
      const cover = product.images[0]?.url || "";
      return `<a class="item" href="#/products/${product.id}" data-code="${esc(product.code)}">
        <span class="thumb" style="${cover ? `background-image:url('${esc(cover)}')` : ""}"></span>
        <span><strong class="code">${esc(product.code)}</strong><br><span class="meta">${esc(product.category)}${product.published ? "" : '<em class="off">下架</em>'}</span></span>
        <span class="meta">${product.price ? `¥${esc(product.price)}` : "询价"}</span>
      </a>`;
    })
    .join("");
  return `<div class="row-head">
      <div><h1>款式</h1><p class="sub">一个货号是一批配色。</p></div>
      <input class="search" id="filter" placeholder="找货号" />
    </div>
    <p><a class="primary" href="#/products/new" style="display:inline-grid;place-items:center">添加一款</a></p>
    <div class="list" id="list">${items || '<p class="empty">还没有款。货号按厂里的写法，比如 2026-12。</p>'}</div>
    ${banner()}`;
}

function editorView(id) {
  const product = id === "new" ? blankProduct() : state.products.find((item) => String(item.id) === id);
  if (!product) return `<p class="empty">没有这一款。<a href="#/products">返回</a></p>`;
  const options = state.categories
    .map((category) => `<option value="${category.id}" ${category.id === product.categoryId ? "selected" : ""}>${esc(category.name)}</option>`)
    .join("");
  const shots = (product.images || [])
    .map(
      (image) => `<span class="shot">
        <span class="thumb" style="background-image:url('${esc(image.url)}')"></span>
        <button class="text-btn danger" type="button" data-remove-image="${image.id}">删除</button>
      </span>`,
    )
    .join("");
  return `<form id="editor">
    <div class="editor-head"><h1>${id === "new" ? "新的一款" : esc(product.code)}</h1></div>
    ${banner()}
    <div class="editor">
      <div>
        <div class="film">${shots}</div>
        <label class="file-btn">添加配色图
          <input id="files" type="file" accept="image/jpeg,image/png,image/webp" multiple />
        </label>
        <p class="help">一次选多张。先保存货号，图会跟着传上去。</p>
      </div>
      <div>
        <div class="grid">
          ${field("货号", "code", product.code)}
          <label class="field"><span>分类</span><select name="categoryId">${options}</select></label>
          ${field("价格", "price", product.price || "", "空着就是询价")}
          ${field("鞋底", "sole", product.sole)}
          ${field("面料", "upper", product.upper)}
          ${field("码段", "sizes", product.sizes, "39-44")}
          ${field("装箱", "pack", product.pack)}
          ${field("起订", "moq", product.moq)}
          <label class="field wide"><span>备注</span><textarea name="note">${esc(product.note)}</textarea></label>
        </div>
        <label class="check"><input name="published" type="checkbox" ${product.published ? "checked" : ""} />上架</label>
        <div class="actions">
          <button class="primary" type="submit">保存</button>
          ${id === "new" ? "" : '<button class="text-btn danger" type="button" id="remove">删除这款</button>'}
          <a class="text-btn" href="#/products">返回</a>
        </div>
      </div>
    </div>
  </form>`;
}

function categoriesView() {
  const rows = state.categories
    .map(
      (category, index) => `<div class="cat-row" data-id="${category.id}">
        <input value="${esc(category.name)}" aria-label="分类名" />
        <button class="ghost" type="button" data-move="-1" ${index === 0 ? "disabled" : ""}>上移</button>
        <button class="ghost" type="button" data-move="1" ${index === state.categories.length - 1 ? "disabled" : ""}>下移</button>
        <button class="text-btn" type="button" data-save>保存</button>
        <button class="text-btn danger" type="button" data-delete>删除</button>
      </div>`,
    )
    .join("");
  return `<div class="row-head"><div><h1>分类</h1><p class="sub">左侧那一列，按厂里的叫法。</p></div></div>
    ${banner()}
    <div id="cats">${rows}</div>
    <form class="add-row" id="add-cat"><input name="name" placeholder="新分类" /><button class="primary" type="submit">添加</button></form>`;
}

function siteView() {
  const site = state.site;
  return `<form id="site">
    <div class="site-head"><div><h1>联系与介绍</h1><p class="sub">电话、地址和厂门口那张图。</p></div></div>
    ${banner()}
    ${site.heroImage ? `<img class="hero-preview" alt="" src="${esc(site.heroImage)}" />` : ""}
    <label class="file-btn">上传厂门口的图<input id="hero" type="file" accept="image/jpeg,image/png,image/webp" /></label>
    ${site.heroImage ? '<p><button class="text-btn danger" type="button" id="clear-hero">去掉横图</button></p>' : ""}
    <div class="grid" style="margin-top:16px">
      ${field("厂名", "company", site.company)}
      ${field("一句介绍", "tagline", site.tagline)}
      ${field("电话一", "phone1", site.phone1)}
      ${field("电话二", "phone2", site.phone2)}
      ${field("微信", "wechat", site.wechat)}
      <label class="field wide"><span>地址</span><input name="address" value="${esc(site.address)}" /></label>
      ${field("纬度", "latitude", site.latitude ?? "", "高德拾取")}
      ${field("经度", "longitude", site.longitude ?? "")}
      <label class="field wide"><span>介绍</span><textarea name="about">${esc(site.about)}</textarea></label>
    </div>
    <p class="help">纬度经度都填上之后，联系页才能打开导航。</p>
    <button class="primary" type="submit">保存</button>
  </form>`;
}

function field(label, name, value, placeholder = "") {
  return `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" /></label>`;
}

function banner() {
  if (state.error) return `<p class="banner">${esc(state.error)}</p>`;
  if (state.notice) return `<p class="banner">${esc(state.notice)}</p>`;
  return "";
}

function blankProduct() {
  return {
    code: "",
    categoryId: state.categories[0]?.id,
    price: "",
    sole: "",
    upper: "",
    sizes: "",
    pack: "",
    moq: "",
    note: "",
    published: true,
    images: [],
  };
}

function bindLogin() {
  app.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.error = "";
    try {
      const data = await api("/login", { method: "POST", json: { password: event.target.password.value } });
      sessionStorage.setItem("snb_token", data.token);
      state.notice = "";
      location.hash = "#/products";
      await refresh();
      draw();
    } catch (error) {
      state.error = error.message;
      draw();
    }
  });
}

function bindShell(current) {
  document.querySelector("#logout").addEventListener("click", () => {
    sessionStorage.removeItem("snb_token");
    location.hash = "#/login";
    draw();
  });
  const filter = document.querySelector("#filter");
  if (filter) {
    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      document.querySelectorAll("#list .item").forEach((row) => {
        row.hidden = query.length > 0 && !row.dataset.code.toLowerCase().includes(query);
      });
    });
  }
  const editor = document.querySelector("#editor");
  if (editor) bindEditor(editor, current.id);
  const cats = document.querySelector("#cats");
  if (cats) bindCategories();
  const site = document.querySelector("#site");
  if (site) bindSite(site);
}

function bindEditor(form, id) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.error = "";
    const payload = readForm(form);
    try {
      const saved =
        id === "new"
          ? await api("/products", { method: "POST", json: payload })
          : await api(`/products/${id}`, { method: "PATCH", json: payload });
      await uploadPending(saved.product.id, form.querySelector("#files").files);
      state.notice = "已保存";
      await refresh();
      if (id === "new") {
        location.hash = `#/products/${saved.product.id}`;
        return;
      }
      draw();
    } catch (error) {
      state.error = error.message;
      draw();
    }
  });
  form.querySelectorAll("[data-remove-image]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/products/${id}/images/${button.dataset.removeImage}`, { method: "DELETE" });
      state.notice = "已删除图片";
      await refresh();
      draw();
    });
  });
  const remove = document.querySelector("#remove");
  if (remove) {
    remove.addEventListener("click", async () => {
      if (!confirm("删除这款和它的图片？")) return;
      await api(`/products/${id}`, { method: "DELETE" });
      state.notice = "已删除";
      await refresh();
      location.hash = "#/products";
    });
  }
}

async function uploadPending(id, files) {
  for (const file of files) {
    const body = new FormData();
    body.append("file", file);
    await api(`/products/${id}/images`, { method: "POST", body });
  }
}

function bindCategories() {
  document.querySelector("#add-cat").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/categories", { method: "POST", json: { name: event.target.name.value } });
      state.notice = "已添加";
      state.error = "";
      await refresh();
      draw();
    } catch (error) {
      state.error = error.message;
      draw();
    }
  });
  document.querySelectorAll(".cat-row").forEach((row) => {
    row.querySelector("[data-save]").addEventListener("click", async () => {
      try {
        await api(`/categories/${row.dataset.id}`, { method: "PATCH", json: { name: row.querySelector("input").value } });
        state.notice = "已保存";
        state.error = "";
        await refresh();
        draw();
      } catch (error) {
        state.error = error.message;
        draw();
      }
    });
    row.querySelector("[data-delete]").addEventListener("click", async () => {
      try {
        await api(`/categories/${row.dataset.id}`, { method: "DELETE" });
        state.notice = "已删除";
        await refresh();
        draw();
      } catch (error) {
        state.error = error.message;
        draw();
      }
    });
    row.querySelectorAll("[data-move]").forEach((button) => {
      button.addEventListener("click", async () => {
        const ids = state.categories.map((category) => category.id);
        const index = ids.indexOf(Number(row.dataset.id));
        const next = index + Number(button.dataset.move);
        [ids[index], ids[next]] = [ids[next], ids[index]];
        await api("/categories/order", { method: "PUT", json: { ids } });
        await refresh();
        draw();
      });
    });
  });
}

function bindSite(form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readForm(form);
    payload.latitude = payload.latitude === "" ? null : Number(payload.latitude);
    payload.longitude = payload.longitude === "" ? null : Number(payload.longitude);
    try {
      await api("/site", { method: "PUT", json: payload });
      const hero = document.querySelector("#hero").files[0];
      if (hero) {
        const body = new FormData();
        body.append("file", hero);
        await api("/site/hero", { method: "POST", body });
      }
      state.notice = "已保存";
      state.error = "";
      await refresh();
      draw();
    } catch (error) {
      state.error = error.message;
      draw();
    }
  });
  const clear = document.querySelector("#clear-hero");
  if (clear) {
    clear.addEventListener("click", async () => {
      await api("/site/hero", { method: "DELETE" });
      state.notice = "已去掉横图";
      await refresh();
      draw();
    });
  }
}

function readForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.published = Boolean(form.querySelector("[name=published]")?.checked);
  if (data.categoryId) data.categoryId = Number(data.categoryId);
  return data;
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
