# Materias primas

Tablero web para cruzar productos de importación, composición y referencias de mercado.

## Uso

Abre la web en GitHub Pages y selecciona **Cargar inventario** para abrir el JSON generado por Seshat. El navegador procesa el archivo en memoria. GitHub Pages aloja el código, las series públicas del Banco Mundial y un ejemplo ficticio. El archivo de inventario se conserva en el equipo autorizado.

El catálogo muestra la evidencia por SKU y permite filtrar por material, familia, etapa y nivel de composición. El simulador usa la participación del insumo que ingreses y un cambio de precio para estimar el efecto sobre el costo unitario.

## Referencias de mercado

El sitio muestra hasta 36 observaciones mensuales por serie del [Banco Mundial, Pink Sheet](https://www.worldbank.org/en/research/commodity-markets). Cada relación identifica si la referencia corresponde al metal, a un componente de la aleación o a un indicador indirecto. GitHub Actions intenta actualizar las series los días 5 y 12 del mes y conserva el despliegue previo si falla la descarga. `update_market.py` también acepta un XLSX oficial con `--xlsx`.

## Desarrollo local

Ejecuta `python -m http.server 8000` desde el directorio del repositorio y abre `http://localhost:8000`. El ejemplo ficticio permite probar la web sin un archivo privado. El flujo de despliegue copia solo los siete archivos públicos enumerados en `pages.yml`.
