import pdfplumber,pathlib
files=[pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\quarantine\raw\technical\SRC-038\SDS_FSSF00058BJ.pdf'),pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\quarantine\raw\technical\SRC-038\datasheet_v1.7.pdf'),pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\quarantine\raw\technical\SRC-038\IEC_certificate.pdf')]
for p in files:
 print('FILE',p.name)
 with pdfplumber.open(p) as pdf:
  pages=[5,8,12,13,17,18] if p.name.startswith('SDS') else [1]
  for n in pages:
   page=pdf.pages[n-1]; print('PAGE',n); print((page.extract_text() or '')[:10000])
