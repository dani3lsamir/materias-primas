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
let page = 0;
let loadRequest = 0;

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
      || !Array.isArray(value.products)) throw Error('El archivo no tiene el formato de inventario de Seshat.');
  const codes = new Set();
  for (const row of value.products) {
    if (!strings(row, ['code', 'name', 'family', 'coverage']) || !row.code || codes.has(row.code) || !Object.hasOwn(coverageLabels, row.coverage)
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
  const products = snapshot.products;
  materialCounts = new Map();
  for (const product of products) {
    for (const material of new Set(product.materials)) materialCounts.set(material, (materialCounts.get(material) ?? 0) + 1);
  }
  $('dataset-label').textContent = demo ? 'Ejemplo ficticio' : `Inventario del ${snapshot.asOf}`;
  $('dataset-detail').textContent = demo ? 'Carga tu archivo JSON para analizar las importaciones reales.' : 'El inventario está disponible en esta pestaña mientras permanezca abierta.';
  options('material', [...materialCounts.keys()].sort(order), 'Todos');
  options('family', [...new Set(products.map(row => row.family))].sort(order), 'Todas');
  $('material-search').value = '';
  resetFilters();
  renderMetrics();
  renderAudit();
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
    label.append(button, el('small', `${product.code} · ${product.family}`));
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
  $('detail-code').textContent = `${product.code} · ${product.family}`;
  $('detail-name').textContent = product.name;
  const materials = product.observations.map(item => [item.value, [materialLabels[item.level], item.source].filter(Boolean).join(' · ')]);
  const evidence = product.evidence.map(item => [`${kindLabels[item.kind]} · ${item.ref}`, [stageLabels[item.stage], item.entity, item.date, item.detail].filter(Boolean).join(' · ')]);
  $('detail-body').replaceChildren(detailGroup('Materiales y fuentes', materials, 'Sin composición específica en las fuentes revisadas.'), detailGroup('Documentos de importación', evidence));
  $('detail').showModal();
}

function csvValue(value) {
  return `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}

function exportRows() {
  const rows = [['SKU', 'Producto', 'Familia', 'Materiales', 'Composición', 'Evidencia']];
  for (const p of filtered) rows.push([p.code, p.name, p.family, p.materials.join(' | '), coverageLabels[p.coverage], [...new Set(p.evidence.map(e => stageLabels[e.stage]))].join(' | ')]);
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

function renderMarket() {
  const market = markets.find(row => row.id === $('series').value);
  if (!market) return;
  const values = market.values.slice(-Number($('period').value));
  const [date, amount] = values.at(-1);
  const previousDate = new Date(`${date}-01T00:00:00Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = values.find(([key]) => key === previousDate.toISOString().slice(0, 7))?.[1];
  monthlyChange = previous ? (amount / previous - 1) * 100 : null;
  const move = monthlyChange === null ? 'Variación mensual no disponible' : `${signed(monthlyChange)} mensual`;
  $('quote').replaceChildren(el('strong', numbers.format(amount)), el('small', market.unit), el('small', move, `change ${monthlyChange > 0 ? 'up' : monthlyChange < 0 ? 'down' : ''}`));
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
for (const id of filters) $(id).addEventListener(id === 'search' ? 'input' : 'change', applyFilters);
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
  renderMarket();
  renderExposure();
} catch {
  $('chart').replaceChildren(el('p', 'La serie de mercado no está disponible en este momento.', 'chart-empty'));
  $('series').disabled = true;
  $('period').disabled = true;
}
