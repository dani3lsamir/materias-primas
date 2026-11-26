const $ = id => document.getElementById(id);
const el = (tag, value = '', css = '') => {
  const node = document.createElement(tag);
  if (value !== '') node.textContent = value;
  if (css) node.className = css;
  return node;
};
const numbers = new Intl.NumberFormat('es-BO', {maximumFractionDigits: 2});
const money = new Intl.NumberFormat('es-BO', {style: 'currency', currency: 'USD', maximumFractionDigits: 4});
const monthFmt = new Intl.DateTimeFormat('es-BO', {month: 'short', year: 'numeric', timeZone: 'UTC'});
const month = value => monthFmt.format(new Date(`${value}-01T00:00:00Z`));
const signed = value => `${value > 0 ? '+' : ''}${numbers.format(value)} %`;
const folded = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const order = (a, b) => a.localeCompare(b, 'es');

const stageLabels = {received: 'Recibido', closed_shipment: 'Embarque cerrado', declared: 'Declarado', active: 'En curso', documented: 'Documentado'};
const stagesConfirmed = new Set(['received', 'closed_shipment', 'declared']);
const coverageLabels = {recorded: 'Registrada', inferred: 'Inferida', missing: 'Por precisar'};
const materialLabels = {spec: 'Ficha de proveedor', reference: 'Referencia técnica', master: 'Ficha aduanera', inferred: 'Indicio en descripción'};
const kindLabels = {packing: 'Lista de empaque', order: 'Registro de pedido', declaration: 'Declaración aduanera', dam: 'DAM provisional', invoice: 'Factura comercial', proforma: 'Proforma vinculada'};
const filters = ['search', 'material', 'family', 'stage', 'coverage'];
const pageSize = 15;
let snapshot = null;
let markets = [];
let monthlyChange = null;
let filtered = [];
let materialCounts = new Map();
let marketProducts = new Map();
let relatedMarket = '';
let relatedPage = 0;
let page = 0;
let loadRequest = 0;
let showingDemo = false;
let inventoryDatabase;
let pendingInventorySaves = 0;

// Links describe the relationship to each specific public series.
const relationships = {
  'Cobre': [['copper', 'Referencia directa del metal']],
  'Aluminio': [['aluminum', 'Referencia directa del metal']],
  'Zinc': [['zinc', 'Metal base. La aleación puede tener otro precio.']],
  'Latón': [['copper', 'Componente del latón'], ['zinc', 'Componente del latón']],
  'Bronce': [['copper', 'Componente de muchas aleaciones de bronce'], ['tin', 'Componente de los bronces al estaño. Confirma la aleación.']],
  'Aluminio recubierto de cobre (CCA)': [['aluminum', 'Núcleo de aluminio'], ['copper', 'Recubrimiento de cobre']],
  'Acero': [['iron', 'Indicador indirecto. El mineral de hierro es un insumo del acero.']],
  'Hierro': [['iron', 'Indicador indirecto del insumo mineral']],
  'Acero inoxidable': [['iron', 'Indicador indirecto del insumo mineral'], ['nickel', 'Insumo de ciertos grados. Confirma el grado antes de usarlo.']],
  'Caucho': [['rubber', 'Referencia del caucho natural. Confirma si el componente es natural o sintético.']],
  'Contrachapado': [['plywood', 'Referencia comercial de contrachapado. Confirma grado y espesor.']],
};
for (const material of ['ABS','PVC','CPVC','PBT','PEI','PPO','Policarbonato','Polietileno','Polipropileno','Poliuretano','Poliéster','Nailon','Plástico sin especificar']) {
  relationships[material] = [['brent', 'Señal indirecta de energía y petroquímica. No mide el precio de esta resina.']];
}

const lmeCopper = ['LME Copper · consulta diaria', 'https://www.lme.com/metals/non-ferrous/lme-copper#Overview'];
const lmeMetals = ['LME · precios oficiales', 'https://www.lme.com/en/market-data/reports-and-data/lme-official-prices'];
const lmeSteel = ['LME · referencias de acero', 'https://www.lme.com/metals/ferrous'];
const clay = ['USGS · arcillas y caolín', 'https://www.usgs.gov/centers/national-minerals-information-center/clays-statistics-and-information'];
const silica = ['USGS · sílice industrial', 'https://www.usgs.gov/centers/national-minerals-information-center/silica-statistics-and-information'];
const resins = ['BLS · índice de resinas de EE. UU.', 'https://fred.stlouisfed.org/series/WPU066'];
const materialSources = new Map([
  ['Cobre', [lmeCopper]], ['Latón', [lmeCopper, lmeMetals]], ['Bronce', [lmeCopper, lmeMetals]],
  ['Zinc', [lmeMetals]], ['Aluminio', [lmeMetals]], ['Aluminio recubierto de cobre (CCA)', [lmeCopper, lmeMetals]],
  ['Acero', [lmeSteel]], ['Acero inoxidable', [lmeMetals]], ['Hierro', [lmeSteel]],
  ['Cerámica', [clay]], ['Porcelana', [clay, ['USGS · feldespato', 'https://www.usgs.gov/centers/national-minerals-information-center/feldspar-statistics-and-information']]],
  ['Fibra óptica', [silica]], ['Fibra de vidrio', [silica]],
  ['Silicona', [['USGS · silicio como insumo', 'https://www.usgs.gov/centers/national-minerals-information-center/silicon-statistics-and-information']]],
  ['Vidrio', [['BLS · índice de vidrio plano de EE. UU.', 'https://fred.stlouisfed.org/series/WPU1311']]],
  ['Papel o cartón', [['BLS · índice de pulpa, papel y afines de EE. UU.', 'https://fred.stlouisfed.org/series/WPU09']]],
]);
for (const [material, links] of Object.entries(relationships)) {
  if (links[0][0] === 'brent') materialSources.set(material, [resins]);
}
const marketSources = new Map([
  ['copper', lmeCopper], ['aluminum', lmeMetals], ['zinc', lmeMetals], ['nickel', lmeMetals], ['tin', lmeMetals], ['iron', lmeSteel],
]);
const relatedPageSize = 8;

function categoryOf(product) {
  return product.category || product.family;
}

function indexMarketProducts(products) {
  const index = new Map();
  for (const product of products) {
    const matches = new Map();
    for (const material of new Set(product.materials)) {
      for (const [id, note] of Object.hasOwn(relationships, material) ? relationships[material] : []) {
        if (!matches.has(id)) matches.set(id, []);
        matches.get(id).push({material, note});
      }
    }
    for (const [id, links] of matches) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push({product, links});
    }
  }
  for (const rows of index.values()) {
    rows.sort((a, b) => Number(stageMatch(b.product, 'active')) - Number(stageMatch(a.product, 'active'))
      || order(a.product.name, b.product.name) || order(a.product.code, b.product.code));
  }
  return index;
}

function groupCategories(rows) {
  const counts = new Map();
  for (const {product} of rows) {
    const category = categoryOf(product);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts].sort(([a, n], [b, m]) => m - n || order(a, b));
}

function sourceLink([label, href]) {
  const link = el('a', `${label} ↗`);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

async function publicData(name) {
  const embedded = $(`${name}-data`);
  if (embedded) return JSON.parse(embedded.textContent);
  const response = await fetch(`${name}.json`);
  if (!response.ok) throw Error('No se pudieron cargar los datos públicos.');
  return response.json();
}

function validateSnapshot(value) {
  const strings = (row, keys) => !!row && keys.every(key => typeof row[key] === 'string');
  const listOfStrings = list => Array.isArray(list) && list.every(item => typeof item === 'string');
  if (value?.version !== 1 || typeof value.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf)
      || !Array.isArray(value.products)) throw Error('El archivo no tiene el formato esperado de inventario.');
  const codes = new Set();
  for (const row of value.products) {
    if (!strings(row, ['code', 'name', 'family', 'coverage']) || !row.code || codes.has(row.code) || !Object.hasOwn(coverageLabels, row.coverage)
        || ['category', 'model'].some(key => Object.hasOwn(row, key) && typeof row[key] !== 'string')
        || !listOfStrings(row.materials) || !Array.isArray(row.observations) || !Array.isArray(row.evidence) || !row.evidence.length
        || !row.observations.every(item => strings(item, ['level', 'value', 'source']) && Object.hasOwn(materialLabels, item.level) && listOfStrings(item.materials))
        || !row.evidence.every(item => strings(item, ['kind', 'stage', 'ref', 'entity', 'date', 'detail']) && Object.hasOwn(stageLabels, item.stage) && Object.hasOwn(kindLabels, item.kind))) {
      throw Error('Hay productos duplicados o campos inválidos en el inventario.');
    }
    codes.add(row.code);
  }
  return value;
}

function options(id, values, first) {
  $(id).replaceChildren(new Option(first, ''), ...values.map(value => new Option(value, value)));
}

function setSnapshot(data, demo = false) {
  snapshot = validateSnapshot(data);
  showingDemo = demo;
  const products = snapshot.products;
  marketProducts = indexMarketProducts(products);
  materialCounts = new Map();
  for (const product of products) {
    for (const material of new Set(product.materials)) materialCounts.set(material, (materialCounts.get(material) ?? 0) + 1);
  }
  $('dataset-label').textContent = demo ? 'Ejemplo ficticio' : `Inventario del ${snapshot.asOf}`;
  $('dataset-detail').textContent = demo ? 'Carga tu archivo JSON para analizar las importaciones reales.' : 'Los datos se procesan en tu navegador.';
  options('material', [...materialCounts.keys()].sort(order), 'Todos');
  options('family', [...new Set(products.map(row => row.family))].sort(order), 'Todas');
  $('material-search').value = '';
  resetFilters();
  renderMetrics();
  renderAudit();
  renderDashboard();
  if ($('series').value) {
    relatedMarket = '';
    renderRelated($('series').value);
  }
}

function stageMatch(product, stage) {
  return product.evidence.some(item => item.stage === stage || (stage === 'confirmed' && stagesConfirmed.has(item.stage)));
}

function renderMetrics() {
  const items = snapshot?.products;
  const counts = items && [items.length, items.filter(p => stageMatch(p, 'confirmed')).length,
    items.filter(p => stageMatch(p, 'active')).length, items.filter(p => p.coverage === 'recorded').length];
  const titles = ['SKU con evidencia', 'Declarados, recibidos o cerrados', 'SKU en curso', 'Composición registrada'];
  $('metrics').replaceChildren(...titles.map((label, index) => {
    const card = el('div', '', 'metric');
    card.append(el('strong', counts ? numbers.format(counts[index]) : '—'), el('span', label));
    return card;
  }));
}

function renderAudit() {
  const audit = snapshot?.audit;
  const list = $('audit');
  list.replaceChildren();
  if (!audit || !Number.isInteger(audit.activeOrders) || !Number.isInteger(audit.matchedActiveOrders)) return;
  list.append(el('p', `${audit.matchedActiveOrders} de ${audit.activeOrders} órdenes activas tienen algún SKU identificado en un documento o en el registro del pedido. La cobertura por orden puede ser parcial.`));
  if (Array.isArray(audit.activeOrdersWithoutLines) && audit.activeOrdersWithoutLines.every(value => typeof value === 'string') && audit.activeOrdersWithoutLines.length) {
    list.append(el('p', `Órdenes activas sin SKU vinculado: ${audit.activeOrdersWithoutLines.join(', ')}.`));
  }
  if (Number.isInteger(audit.unmatchedDeclarationLines)) list.append(el('p', `${audit.unmatchedDeclarationLines} renglones de declaraciones quedan pendientes de vincular a un SKU.`));
}

function resetFilters() {
  for (const id of filters) $(id).value = '';
  applyFilters();
}

function applyFilters() {
  const [query, material, family, stage, coverage] = filters.map(id => $(id).value);
  const words = folded(query).trim().split(/\s+/).filter(Boolean);
  filtered = (snapshot?.products ?? []).filter(p => {
    const haystack = folded([p.code, p.name, p.family, ...p.materials].join(' '));
    return (!material || p.materials.includes(material)) && (!family || p.family === family)
      && (!stage || stageMatch(p, stage)) && (!coverage || p.coverage === coverage)
      && words.every(word => haystack.includes(word));
  });
  page = 0;
  renderTable();
  renderExposure();
}

function renderExposure() {
  const query = folded($('material-search').value.trim());
  const ranking = [...materialCounts].filter(([material]) => folded(material).includes(query))
    .sort(([a, n], [b, m]) => m - n || order(a, b));
  $('materials-count').textContent = snapshot ? `${ranking.length} de ${materialCounts.size} materiales` : '';
  $('material-search').disabled = !snapshot;
  const selected = $('material').value;
  $('exposure-list').replaceChildren();
  if (!ranking.length) $('exposure-list').append(el('p', snapshot ? 'Sin coincidencias.' : 'Carga el inventario o abre el ejemplo para ver los materiales.', 'empty'));
  for (const [material, count] of ranking) {
    const button = el('button', '', 'bar-button');
    button.dataset.material = material;
    button.setAttribute('aria-pressed', selected === material);
    const meter = el('meter');
    meter.max = snapshot.products.length;
    meter.value = count;
    meter.setAttribute('aria-hidden', 'true');
    button.append(el('span', material), el('strong', numbers.format(count)), meter);
    button.addEventListener('click', () => {
      $('material').value = material;
      const first = Object.hasOwn(relationships, material) ? relationships[material][0] : null;
      if (first && markets.some(market => market.id === first[0])) {
        $('series').value = first[0];
        renderMarket();
      }
      applyFilters();
      [...$('exposure-list').children].find(item => item.dataset.material === material)?.focus({preventScroll: true});
    });
    $('exposure-list').append(button);
  }
  $('relationship').replaceChildren();
  if (!selected) return;
  const group = el('div', '', 'relationship');
  const header = el('div', '', 'relationship-head');
  const productsLink = el('a', 'Ver productos ↓');
  productsLink.href = '#catalogo';
  header.append(el('strong', selected), productsLink);
  group.append(header);
  for (const [id, note] of Object.hasOwn(relationships, selected) ? relationships[selected] : []) {
    const market = markets.find(row => row.id === id);
    if (!market) continue;
    const line = el('div');
    const button = el('button', market.label, 'text-button');
    button.addEventListener('click', () => { $('series').value = id; renderMarket(); $('series').focus(); });
    line.append(button, document.createTextNode(` · ${note}`));
    group.append(line);
  }
  if (group.childElementCount === 1) group.append(el('p', 'Sin serie de precio vinculada. Consulta la ficha del producto y el grado del material.'));
  const categories = groupCategories(snapshot.products.filter(product => product.materials.includes(selected)).map(product => ({product})));
  if (categories.length) group.append(el('p', categories.map(([name, count]) => `${name} (${count})`).join(' · ')));
  for (const source of materialSources.get(selected) ?? []) {
    const line = el('div', '', 'relation-source');
    line.append(sourceLink(source));
    group.append(line);
  }
  $('relationship').append(group);
}

function table(headers) {
  const grid = el('table');
  const top = el('thead');
  const row = el('tr');
  for (const header of headers) { const th = el('th', header); th.scope = 'col'; row.append(th); }
  top.append(row);
  const body = el('tbody');
  grid.append(top, body);
  return [grid, body];
}

function renderTable() {
  $('result-count').textContent = snapshot ? `${numbers.format(filtered.length)} de ${numbers.format(snapshot.products.length)} productos` : 'Sin inventario cargado';
  $('export').disabled = !filtered.length;
  const pages = Math.ceil(filtered.length / pageSize);
  $('pagination').hidden = pages < 2;
  $('page').textContent = `${page + 1} / ${pages}`;
  $('prev').disabled = page === 0;
  $('next').disabled = page + 1 >= pages;
  if (!filtered.length) {
    $('table').replaceChildren(el('p', snapshot ? 'Ningún producto coincide con los filtros.' : 'Carga tu inventario o prueba el ejemplo para explorar el catálogo.', 'empty'));
    return;
  }
  const [grid, body] = table(['Producto', 'Materiales identificados', 'Evidencia de importación', 'Composición']);
  for (const product of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = el('tr');
    const label = el('td');
    const button = el('button', product.name, 'text-button');
    button.addEventListener('click', () => openDetail(product));
    label.append(button, el('small', [...new Set([product.code, product.model, categoryOf(product), product.family].filter(Boolean))].join(' · ')));
    const tags = el('td');
    if (!product.materials.length) tags.textContent = '—';
    for (const material of product.materials) tags.append(el('span', material, 'tag'));
    const stages = [...new Set(product.evidence.map(item => stageLabels[item.stage]))];
    row.append(label, tags, el('td', stages.join(' · ')), el('td', coverageLabels[product.coverage], product.coverage));
    body.append(row);
  }
  $('table').replaceChildren(grid);
}

function detailGroup(title, entries, fallback) {
  const group = el('section', '', 'detail-group');
  group.append(el('h3', title));
  const list = el('ul');
  for (const [value, source] of entries) {
    const li = el('li', value);
    li.append(el('small', source));
    list.append(li);
  }
  if (!entries.length) list.append(el('li', fallback));
  group.append(list);
  return group;
}

function openDetail(product) {
  $('detail-code').textContent = [product.code, product.model, categoryOf(product)].filter(Boolean).join(' · ');
  $('detail-name').textContent = product.name;
  const materials = product.observations.map(item => [item.value, [materialLabels[item.level], item.source].filter(Boolean).join(' · ')]);
  const evidence = product.evidence.map(item => {
    const reference = item.kind === 'order' ? item.ref
      .replace(/^(P\d+) · detalle registrado en [^·]+$/, '$1')
      .replace(/^(P\d+ · código abreviado .+) en el detalle de [^·]+$/, '$1') : item.ref;
    return [`${kindLabels[item.kind]} · ${reference}`, [stageLabels[item.stage], item.entity, item.date, item.detail].filter(Boolean).join(' · ')];
  });
  $('detail-body').replaceChildren(detailGroup('Materiales y fuentes', materials, 'Sin composición específica en las fuentes revisadas.'), detailGroup('Documentos de importación', evidence));
  $('detail').showModal();
}

function csvValue(value) {
  return `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}

function exportRows() {
  const rows = [['SKU', 'Producto', 'Familia', 'Materiales', 'Composición', 'Evidencia', 'Categoría', 'Modelo']];
  for (const p of filtered) rows.push([p.code, p.name, p.family, p.materials.join(' | '), coverageLabels[p.coverage], [...new Set(p.evidence.map(e => stageLabels[e.stage]))].join(' | '), categoryOf(p), p.model || '']);
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(csvValue).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'}));
  const link = el('a');
  link.href = url;
  link.download = `materials-view-${snapshot.asOf}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function svg(tag, fields, value = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(fields)) node.setAttribute(key, val);
  if (value) node.textContent = value;
  return node;
}

function drawChart(values, label, unit) {
  const min = Math.min(...values.map(([, value]) => value));
  const max = Math.max(...values.map(([, value]) => value));
  const pad = (max - min || max * .05) * .12;
  const bottom = min - pad;
  const range = max + pad - bottom;
  const x = i => 61 + i * 513 / Math.max(1, values.length - 1);
  const y = value => 145 - (value - bottom) * 126 / range;
  const plot = svg('svg', {viewBox: '0 0 606 176', role: 'img', 'aria-label': `Serie mensual de ${label} en ${unit}`});
  for (let i = 0; i < 4; i++) {
    const pos = 19 + i * 42;
    plot.append(svg('line', {x1: 61, x2: 574, y1: pos, y2: pos, class: 'chart-grid'}),
      svg('text', {x: 53, y: pos + 4, class: 'chart-label', 'text-anchor': 'end'}, numbers.format(bottom + range * (1 - i / 3))));
  }
  const points = values.map(([, value], i) => `${x(i)},${y(value)}`);
  plot.append(svg('polygon', {points: `${x(0)},145 ${points.join(' ')} ${x(values.length - 1)},145`, class: 'chart-area'}),
    svg('polyline', {points: points.join(' '), class: 'chart-line', 'stroke-width': 2.5, 'stroke-linejoin': 'round'}));
  for (const index of [0, Math.floor((values.length - 1) / 2), values.length - 1]) {
    plot.append(svg('text', {x: x(index), y: 166, class: 'chart-label', 'text-anchor': 'middle'}, month(values[index][0])));
  }
  values.forEach(([date, value], index) => {
    const point = svg('circle', {cx: x(index), cy: y(value), r: index === values.length - 1 ? 5 : 2.6, class: 'chart-point'});
    point.append(svg('title', {}, `${month(date)} · ${numbers.format(value)} ${unit}`));
    plot.append(point);
  });
  $('chart').replaceChildren(plot);
}

function recentMarket(market) {
  const [date, amount] = market.values.at(-1);
  const previousDate = new Date(`${date}-01T00:00:00Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = market.values.find(([key]) => key === previousDate.toISOString().slice(0, 7))?.[1];
  return {date, amount, change: previous ? (amount / previous - 1) * 100 : null};
}

function changeStyle(value) {
  return `change ${value > 0 ? 'up' : value < 0 ? 'down' : ''}`;
}

function renderDashboard() {
  $('market-dashboard').replaceChildren(...markets.map(market => {
    const {date, amount, change} = recentMarket(market);
    const card = el('button', '', 'market-card');
    card.dataset.series = market.id;
    card.setAttribute('aria-pressed', $('series').value === market.id);
    card.setAttribute('aria-controls', 'market-related');
    const title = el('span', '', 'market-card-title');
    title.append(el('strong', market.label), el('small', month(date)));
    const value = el('span', '', 'market-card-value');
    value.append(el('strong', numbers.format(amount)), el('small', market.unit));
    const move = el('span', change === null ? 'Variación no disponible' : `${signed(change)} mensual`, changeStyle(change));
    const matches = marketProducts.get(market.id) ?? [];
    const summary = el('span', '', 'market-card-products');
    if (snapshot) {
      const categories = groupCategories(matches);
      summary.append(el('strong', matches.length ? `${numbers.format(matches.length)} SKU relacionados` : 'Sin SKU vinculados'));
      if (categories.length) summary.append(el('span', categories.slice(0, 2).map(([label]) => label).join(' · ')));
    } else {
      summary.append(el('span', 'Ver histórico →'));
    }
    card.append(title, value, move, summary);
    card.addEventListener('click', () => {
      $('series').value = market.id;
      renderMarket();
      const heading = $(snapshot ? 'related-heading' : 'market-history');
      heading.focus({preventScroll: true});
      heading.scrollIntoView({block: 'start'});
    });
    return card;
  }));
}

function renderRelated(id) {
  const market = markets.find(item => item.id === id);
  $('market-related').hidden = !snapshot || !market;
  if (!snapshot || !market) return;
  const rows = marketProducts.get(id) ?? [];
  if (relatedMarket !== id) {
    relatedMarket = id;
    relatedPage = 0;
    options('related-category', groupCategories(rows).map(([category]) => category), 'Todas');
  }
  $('related-heading').textContent = `Productos relacionados con ${market.label}`;
  $('related-filter').hidden = !rows.length;
  const selected = $('related-category').value;
  const shown = selected ? rows.filter(({product}) => categoryOf(product) === selected) : rows;
  $('related-note').textContent = rows.length
    ? `${numbers.format(shown.length)} de ${numbers.format(rows.length)} SKU vinculados por sus materiales.`
    : 'El inventario cargado no contiene materiales vinculados con esta referencia.';
  const first = relatedPage * relatedPageSize;
  const pages = Math.ceil(shown.length / relatedPageSize);
  const list = el('ul', '', 'related-list');
  for (const {product, links} of shown.slice(first, first + relatedPageSize)) {
    const item = el('li');
    const identity = el('div');
    const name = el('button', product.name, 'text-button');
    name.addEventListener('click', () => openDetail(product));
    const attributes = [categoryOf(product), `SKU ${product.code}`];
    if (product.model) attributes.push(`Modelo ${product.model}`);
    if (product.coverage !== 'recorded') attributes.push(`Composición ${coverageLabels[product.coverage].toLowerCase()}`);
    identity.append(name, el('small', attributes.join(' · ')));
    const connection = el('div', '', 'related-materials');
    for (const {material, note} of links) {
      connection.append(el('strong', material), el('small', note));
    }
    item.append(identity, connection);
    list.append(item);
  }
  $('related-products').replaceChildren(...(shown.length ? [list] : []));
  $('related-pagination').hidden = pages <= 1;
  $('related-page').textContent = pages ? `${relatedPage + 1} / ${pages}` : '';
  $('related-prev').disabled = relatedPage === 0;
  $('related-next').disabled = relatedPage + 1 >= pages;
}

function renderMarket() {
  const market = markets.find(row => row.id === $('series').value);
  if (!market) return;
  const values = market.values.slice(-Number($('period').value));
  const {date, amount, change} = recentMarket(market);
  monthlyChange = change;
  const move = monthlyChange === null ? 'Variación mensual no disponible' : `${signed(monthlyChange)} mensual`;
  $('quote').replaceChildren(el('strong', numbers.format(amount)), el('small', market.unit), el('small', move, changeStyle(monthlyChange)));
  drawChart(values, market.label, market.unit);
  const marketLabel = market.id === 'copper' ? 'Cobre LME grado A · liquidación' : market.label;
  $('market-note').textContent = `${month(date)} · ${marketLabel} · promedio mensual`;
  const source = marketSources.get(market.id);
  $('market-links').replaceChildren(...(source ? [sourceLink(source)] : []));
  const [grid, body] = table(['Mes', market.unit]);
  for (const [key, value] of [...values].reverse()) {
    const row = el('tr');
    row.append(el('td', month(key)), el('td', numbers.format(value)));
    body.append(row);
  }
  $('series-table').replaceChildren(grid);
  $('use-market').disabled = monthlyChange === null;
  for (const card of $('market-dashboard').children) card.setAttribute('aria-pressed', card.dataset.series === market.id);
  renderRelated(market.id);
}

function renderScenario() {
  const inputs = ['cost', 'share', 'change'].map(id => $(id));
  const [cost, share, change] = inputs.map(input => input.valueAsNumber);
  if (!inputs.every(input => input.checkValidity() && Number.isFinite(input.valueAsNumber))) {
    $('scenario-price').textContent = '—';
    $('scenario-result').textContent = 'Ingresa un costo positivo, una participación de 0 a 100 % y una variación de al menos −100 %.';
    return;
  }
  const impact = (share / 100) * change;
  const estimate = cost * (1 + impact / 100);
  $('scenario-price').textContent = Number.isFinite(estimate) ? money.format(estimate) : '—';
  $('scenario-result').textContent = Number.isFinite(estimate) ? `${signed(impact)} sobre el costo unitario de ${money.format(cost)}.` : 'El resultado excede el rango admitido.';
}

async function inventoryStorage(action, data) {
  inventoryDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('materials-local-inventory', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Almacenamiento local bloqueado.'));
  });
  const db = await inventoryDatabase;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('files');
    const request = action === 'put' ? store.put(data, 'active') : store[action]('active');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function setRemembered(remembered) {
  $('remember').checked = remembered;
  $('forget').hidden = !remembered;
}

async function saveInventory(data) {
  pendingInventorySaves++;
  try {
    await inventoryStorage('put', data);
    setRemembered(true);
    $('file-message').textContent = 'Inventario guardado en este navegador.';
  } catch {
    $('file-message').textContent = 'Inventario abierto. El navegador no pudo recordar el archivo.';
  } finally {
    pendingInventorySaves--;
  }
}

async function forgetInventory() {
  try {
    await inventoryStorage('delete');
    setRemembered(false);
    $('file-message').textContent = 'Se borró la copia guardada en este navegador.';
  } catch {
    $('file-message').textContent = 'El navegador no pudo borrar la copia guardada.';
  }
}

$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const request = ++loadRequest;
  try {
    if (file.size > 30 * 1024 * 1024) throw Error('El archivo supera el límite de 30 MB.');
    const content = await file.text();
    if (request !== loadRequest) return;
    setSnapshot(JSON.parse(content.replace(/^\uFEFF/, '')));
    $('file-message').textContent = 'Inventario cargado.';
    if ($('remember').checked) await saveInventory(snapshot);
  } catch (error) {
    if (request !== loadRequest) return;
    $('file-message').textContent = error instanceof SyntaxError ? 'El archivo no es un JSON válido.' : error.message;
  } finally { if (request === loadRequest) event.target.value = ''; }
});
$('demo').addEventListener('click', async () => {
  const request = ++loadRequest;
  $('file').value = '';
  try {
    const data = await publicData('demo');
    if (request !== loadRequest) return;
    setSnapshot(data, true);
    $('file-message').textContent = '';
  } catch (error) { if (request === loadRequest) $('file-message').textContent = error.message; }
});
$('remember').addEventListener('change', () => {
  if (!$('remember').checked && (!$('forget').hidden || pendingInventorySaves)) void forgetInventory();
  if ($('remember').checked && snapshot && !showingDemo) void saveInventory(snapshot);
});
$('forget').addEventListener('click', forgetInventory);
for (const id of filters) $(id).addEventListener(id === 'search' ? 'input' : 'change', applyFilters);
$('related-category').addEventListener('change', () => { relatedPage = 0; renderRelated(relatedMarket); });
$('related-prev').addEventListener('click', () => { relatedPage--; renderRelated(relatedMarket); });
$('related-next').addEventListener('click', () => { relatedPage++; renderRelated(relatedMarket); });
$('material-search').addEventListener('input', renderExposure);
for (const id of ['series', 'period']) $(id).addEventListener('change', renderMarket);
for (const id of ['cost', 'share', 'change']) $(id).addEventListener('input', renderScenario);
$('reset').addEventListener('click', resetFilters);
$('export').addEventListener('click', exportRows);
$('prev').addEventListener('click', () => { page--; renderTable(); });
$('next').addEventListener('click', () => { page++; renderTable(); });
$('close-detail').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('click', event => { if (event.target === $('detail')) $('detail').close(); });
$('use-market').addEventListener('click', () => { $('change').value = monthlyChange.toFixed(3); renderScenario(); });
options('material', [], 'Todos');
options('family', [], 'Todas');
renderMetrics();
applyFilters();
try {
  markets = (await publicData('market')).series;
  $('series').replaceChildren(...markets.map(row => new Option(row.label, row.id)));
  renderDashboard();
  renderMarket();
  renderExposure();
} catch {
  $('market-dashboard').replaceChildren(el('p', 'Las referencias de mercado no están disponibles en este momento.', 'empty'));
  $('chart').replaceChildren(el('p', 'La serie de mercado no está disponible en este momento.', 'chart-empty'));
  $('series').disabled = true;
  $('period').disabled = true;
}
if (loadRequest === 0) {
  try {
    const saved = await inventoryStorage('get');
    if (saved && loadRequest === 0) {
      setSnapshot(saved);
      setRemembered(true);
      $('file-message').textContent = 'Inventario recuperado de este navegador.';
    }
  } catch {
    // The file picker remains available without browser storage.
  }
}
