"""Refresh the published daily copper, zinc and Brent market series."""

import argparse
import csv
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
BCRP = 'https://estadisticas.bcrp.gob.pe/estadisticas/series'
FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU'
EIA = 'https://www.eia.gov/dnav/pet/hist/RBRTED.htm'
METALS = {'copper': ('PD04701XD', 'Cobre'), 'zinc': ('PD04703XD', 'Zinc')}
MONTHS = {month: index for index, aliases in enumerate(
    ('jan ene', 'feb', 'mar', 'apr abr', 'may', 'jun', 'jul', 'aug ago', 'sep set', 'oct', 'nov', 'dec dic'), 1
) for month in aliases.split()}
POUND_KG = Decimal('0.45359237')
MISSING = {'', '.', 'n.d.'}


def download(url):
    request = Request(url, headers={'User-Agent': 'RawMaterialsDashboard/1', 'Accept': '*/*'})
    with urlopen(request, timeout=25) as response:
        return response.read(750_000).decode('utf-8-sig')


def bcrp_date(value):
    day, month, year = value.split('.')
    year_number = int(year) + (2000 if len(year) == 2 else 0)
    return date(year_number, MONTHS[month.lower()], int(day)).isoformat()


def price(value, factor=Decimal(1)):
    if value is None or str(value).strip().lower() in MISSING:
        return None
    number = Decimal(str(value)) * factor
    if not number.is_finite() or number <= 0:
        raise ValueError(f'Invalid commodity price: {value}')
    return float(round(number, 2))


def history(values):
    if len(values) < 2:
        raise ValueError('Expected at least two observed prices')
    dates = [date.fromisoformat(row[0]) for row in values]
    if dates != sorted(set(dates)) or any(price(row[1]) is None for row in values):
        raise ValueError('Expected unique ordered observations with valid prices')
    return values


def parse_bcrp(payload):
    columns = payload['config']['series']
    if len(columns) != len(METALS):
        raise ValueError('Unexpected BCRP series count')
    result = {}
    for index, (key, (code, label)) in enumerate(METALS.items()):
        if f'{label} (Londres, cUS$ por libras)' not in columns[index]['name']:
            raise ValueError(f'Unexpected BCRP series metadata for {code}')
        rows = []
        for row in payload['periods']:
            value = price(row['values'][index], Decimal(10) / POUND_KG)
            if value is not None:
                rows.append([bcrp_date(row['name']), value])
        result[key] = history(rows)
    return result


def parse_eia(text):
    rows = csv.DictReader(StringIO(text))
    if rows.fieldnames != ['observation_date', 'DCOILBRENTEU']:
        raise ValueError('Unexpected EIA Brent CSV columns')
    return history([[row['observation_date'], value] for row in rows
                    if (value := price(row['DCOILBRENTEU'])) is not None])


def source_meta(key):
    if key == 'brent':
        return {'unit': 'USD/barril', 'publisher': 'EIA · FRED', 'source': EIA,
                'description': 'Brent spot FOB Europa. Serie de la EIA publicada en FRED.'}
    code, _ = METALS[key]
    return {'unit': 'USD/t', 'publisher': 'BCRPData · Reuters',
            'source': f'{BCRP}/diarias/resultados/{code}',
            'description': 'Cotización de Londres del BCRP, fuente Reuters. Conversión a USD/t desde centavos de dólar por libra.'}


def read_previous(payload):
    if payload['version'] != 1:
        raise ValueError('Unexpected daily data version')
    return {series['id']: history(series['values']) for series in payload['series']}


def refresh(out, previous_url=None):
    today = date.today()
    start = today - timedelta(days=365)
    prior = read_previous(json.loads(out.read_text(encoding='utf-8'))) if out.exists() else {}
    if previous_url:
        try:
            served = read_previous(json.loads(download(previous_url)))
        except HTTPError as error:
            if error.code != 404:
                raise
        else:
            for key, rows in served.items():
                if key not in prior or rows[-1][0] >= prior[key][-1][0]:
                    prior[key] = rows

    current = {}
    codes = '-'.join(code for code, _ in METALS.values())
    try:
        current.update(parse_bcrp(json.loads(download(f'{BCRP}/api/{codes}/json/{start}/{today}/ing'))))
    except (OSError, ValueError, KeyError, IndexError, ArithmeticError) as error:
        print(f'BCRP update unavailable: {error}')
    try:
        current['brent'] = parse_eia(download(f'{FRED}&cosd={start}&coed={today}'))
    except (OSError, ValueError, KeyError, ArithmeticError) as error:
        print(f'EIA update unavailable: {error}')

    result = []
    for key in (*METALS, 'brent'):
        new = current.get(key)
        old = prior.get(key)
        if old and (not new or new[-1][0] < old[-1][0]):
            print(f'{key}: retaining the last verified observation {old[-1][0]}')
            new = old
        if not new or new[-1][0] > today.isoformat():
            raise ValueError(f'No usable observations for {key}')
        result.append({'id': key, **source_meta(key), 'values': new})
        print(f'{key}: {len(new)} observations through {new[-1][0]}')
    out.write_text(json.dumps({'version': 1, 'series': result}, ensure_ascii=False, separators=(',', ':')) + '\n',
                   encoding='utf-8', newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'daily.json')
    parser.add_argument('--previous-url', help='Public daily.json from the previous deployment')
    args = parser.parse_args()
    refresh(args.out, args.previous_url)
