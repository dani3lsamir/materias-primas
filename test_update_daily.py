import unittest

from update_daily import bcrp_date, parse_bcrp, parse_eia


class DailySeriesTest(unittest.TestCase):
    def test_metal_prices_convert_and_missing_days_are_skipped(self):
        payload = {'config': {'series': [
            {'name': 'Cobre (Londres, cUS$ por libras)'}, {'name': 'Zinc (Londres, cUS$ por libras)'}]},
            'periods': [{'name': '20.Nov.26', 'values': ['500', '150']},
                        {'name': '23.Nov.26', 'values': ['480', '145']},
                        {'name': '24.Nov.26', 'values': ['n.d.', 'n.d.']}]}
        result = parse_bcrp(payload)
        self.assertEqual(result['copper'], [['2026-11-20', 11023.11], ['2026-11-23', 10582.19]])
        self.assertEqual(result['zinc'][-1], ['2026-11-23', 3196.70])
        payload['config']['series'].reverse()
        with self.assertRaises(ValueError):
            parse_bcrp(payload)

    def test_eia_missing_rows_do_not_become_zero_or_extend_the_cutoff(self):
        csv_text = 'observation_date,DCOILBRENTEU\n2026-11-20,92.76\n2026-11-23,91.20\n2026-11-24,.\n'
        self.assertEqual(parse_eia(csv_text), [['2026-11-20', 92.76], ['2026-11-23', 91.2]])
        with self.assertRaises(ValueError):
            parse_eia(csv_text + '2026-11-23,90\n')

    def test_bcrp_date_handles_english_and_spanish_api_months(self):
        self.assertEqual(bcrp_date('02.Mar.26'), '2026-03-02')
        self.assertEqual(bcrp_date('02.Set.26'), '2026-09-02')
        self.assertEqual(bcrp_date('02.Ene.26'), '2026-01-02')


if __name__ == '__main__':
    unittest.main()
