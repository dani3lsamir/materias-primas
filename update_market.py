"""Build the public market data from the World Bank's monthly Pink Sheet workbook."""

import argparse
import io
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

import openpyxl


SOURCE = 'https://www.worldbank.org/en/research/commodity-markets'
BOOK = ('https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026'
        '/related/CMO-Historical-Data-Monthly.xlsx')
SERIES = {
    'copper': ('Copper', 'Cobre', 'USD/t'),
    'aluminum': ('Aluminum', 'Aluminio', 'USD/t'),
    'zinc': ('Zinc', 'Zinc', 'USD/t'),
    'iron': ('Iron ore, cfr spot', 'Mineral de hierro', 'USD/t seca'),
    'nickel': ('Nickel', 'Níquel', 'USD/t'),
    'tin': ('Tin', 'Estaño', 'USD/t'),
    'brent': ('Crude oil, Brent', 'Petróleo Brent', 'USD/barril'),
    'rubber': ('Rubber, RSS3', 'Caucho natural RSS3', 'USD/kg'),
    'plywood': ('Plywood', 'Contrachapado', '¢ US/hoja'),
}


def download():
    # Follow the current release link so an annual document ID change is harmless.
    with urlopen(Request(SOURCE, headers={'User-Agent': 'MaterialsDashboard/1'}), timeout=30) as response:
        page = response.read().decode('utf-8')
    match = re.search(r'https://thedocs\.worldbank\.org/[^"<>\s]+/CMO-Historical-Data-Monthly\.xlsx', page, re.I)
    book = match[0] if match else BOOK
    with urlopen(book, timeout=60) as response:
        return io.BytesIO(response.read()), book


def generate(workbook, book):
    with_workbook = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    try:
        rows = list(with_workbook['Monthly Prices'].values)
    finally:
        with_workbook.close()
    header_row = next(i for i, row in enumerate(rows[:10]) if 'Copper' in row and 'Aluminum' in row)
    headers = {str(name).strip(): index for index, name in enumerate(rows[header_row]) if name}
    data = []
    for code, (header, label, unit) in SERIES.items():
        col = headers[header]
        values = sorted([f'{row[0][:4]}-{row[0][-2:]}', round(row[col], 4)]
                        for row in rows[header_row + 1:] if re.fullmatch(r'\d{4}M(?:0[1-9]|1[0-2])', str(row[0]))
                        and isinstance(row[col], (float, int)) and row[col] > 0)[-36:]
        if len(values) < 12 or len({date for date, _ in values}) != len(values):
            raise ValueError(f'Unexpected monthly history for {header}')
        data.append({'id': code, 'label': label, 'unit': unit, 'values': values})
    return {'publisher': 'Banco Mundial · Pink Sheet', 'source': SOURCE, 'workbook': book, 'series': data}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xlsx', type=Path)
    parser.add_argument('--out', type=Path, default=Path(__file__).with_name('market.json'))
    args = parser.parse_args()
    workbook, book = (args.xlsx, BOOK) if args.xlsx else download()
    result = generate(workbook, book)
    if args.out.exists():
        existing = {series['id']: series['values'][-1][0]
                    for series in json.loads(args.out.read_text(encoding='utf-8'))['series']}
        if any(series['values'][-1][0] < existing.get(series['id'], '') for series in result['series']):
            raise ValueError('The downloaded release is older than the published data')
    args.out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    print(', '.join(f"{row['id']} {row['values'][-1][0]}" for row in result['series']))


if __name__ == '__main__':
    main()
