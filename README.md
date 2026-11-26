# Raw Materials Dashboard

A procurement dashboard for exploring imported products, their material composition, and commodity price benchmarks. The dashboard is displayed in Spanish.

## Use the dashboard

Open the [GitHub Pages site](https://dani3lsamir.github.io/materias-primas/) and select **Cargar inventario** to open a Seshat inventory JSON file. The browser processes the file in memory. GitHub Pages serves the application, the public market series, and a fictional sample inventory.

The main dashboard shows all monthly benchmarks together. Select a card to open the related categories and products, with the documented model when available and the SKU for every product. Each row explains its material relationship to the benchmark. Search the material explorer to see every material tag in the loaded inventory, its product count, and any benchmark or external reference available.

Select **Recordar inventario en este navegador** to store a copy in this browser and open it automatically on later visits. Use **Borrar inventario recordado** to remove that local copy. Import and export stay in the browser. The simulator estimates the change in unit cost from a user-entered input cost share and price movement.

## Data sources

- **Products and composition.** The local Seshat export combines import and purchase evidence with documented material fields. The catalog labels material inferred from a description and flags products with unspecified composition.
- **Monthly commodity prices.** The [World Bank Pink Sheet](https://www.worldbank.org/en/research/commodity-markets) provides up to 36 observations per series. Material links identify direct commodity benchmarks, components of an alloy, and indirect indicators.
- **Copper.** The Pink Sheet workbook describes its copper series as the LME Grade A settlement price. The dashboard uses the World Bank's monthly USD-per-tonne observations. [LME Copper](https://www.lme.com/metals/non-ferrous/lme-copper#Overview) provides the exchange's contract and more recent market data. The LME publishes separate [licensing requirements for public display of its market data](https://www.lme.com/en/market-data/market-data-licensing/data-distribution).

GitHub Actions attempts to refresh the Pink Sheet series on the 5th and 12th of each month and preserves the existing deployment if the download fails. `update_market.py` also accepts the official workbook through `--xlsx`.

## Local development

Run `python build.py` from the repository root. Serve `_site` with `python -m http.server 8000 --directory _site` and open `http://localhost:8000`. Select **Probar con un ejemplo** to use the sample inventory.

Open `_site/offline.html` directly to use the single-file build without a network connection. It includes the market snapshot and sample inventory. Load your own inventory JSON with **Cargar inventario**. The build reads a fixed list of public source files and rejects additional files in its output directory.
