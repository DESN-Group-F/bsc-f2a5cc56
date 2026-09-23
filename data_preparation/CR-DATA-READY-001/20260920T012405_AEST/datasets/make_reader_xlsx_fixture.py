from openpyxl import Workbook
from pathlib import Path
p=Path(__file__).parent/'reader_fixture_formula.xlsx';w=Workbook();s=w.active;s['A1']='header';s['B2']='=1+1';w.save(p)
