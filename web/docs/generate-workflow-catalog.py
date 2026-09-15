"""One-shot transcription of frozen briefs, not runtime code."""
import re, json
from pathlib import Path
spec=Path('web/docs/workflow-template-spec.md').read_text(encoding='utf-8')
fields=[ [('sourceUrl','Source URL','url',1024),('language','Summary language','select',None),('maxWords','Maximum words','integer',None)], [('subject','Product or service','text',120),('sources','Review source URLs','url-list',None),('question','Analysis question','textarea',400),('language','Report language','select',None)], [('topic','Event or topic','text',160),('startDate','Start date (UTC)','date',None),('endDate','End date (UTC)','date',None),('sources','Source URLs','url-list',None),('language','Report language','select',None)], [('question','Research question','textarea',400),('sources','Source URLs','url-list',None),('asOfDate','Evidence cutoff date (UTC)','date',None),('language','Report language','select',None)], [('repositoryUrl','Public GitHub repository URL','url',1024),('commit','Commit SHA (40 hex characters)','text',40),('scope','Review scope and paths','textarea',400),('language','Report language','select',None)], [('claim','Claim to check','textarea',400),('sources','Evidence URLs','url-list',None),('asOfDate','Evidence cutoff date (UTC)','date',None),('language','Report language','select',None)]]
blocks=re.split(r'### 4\.\d ',spec)[1:]
cat=[]
for i,b in enumerate(blocks):
 b=b.split('## 5.')[0]
 ident,group,cap=re.search(r'ID/category: `([^`]+)`; group: `([^`]+)`; capability: `([^`]+)`',b).groups()
 price=re.search(r'Suggested reward: min `([^`]+)`, max `([^`]+)`, default `([^`]+)`',b).groups()
 fs=[]
 for key,label,kind,limit in fields[i]:
  f=dict(key=key,label=label,kind=kind)
  if limit: f['maxBytes']=limit
  if kind=='url-list': f.update(min=2 if i in [3,5] else 1,max=3)
  if kind=='integer': f.update(min=150,max=600,defaultValue='400')
  fs.append(f)
 cat.append(dict(id=ident,name=b.splitlines()[0].strip(),group=group,capability=cap,blurb=re.search(r'Blurb: `([^`]+)`',b).group(1),suggestedReward=dict(zip(['min','max','default'],price)),fields=fs,artifactKind='url-summary-v1' if i==0 else 'workflow-report-v1',task='' if i==0 else re.search(r'Task:\s*```text\n(.*?)\n```',b,re.S).group(1),criteria=re.findall(r'^\d\. `([^`]+)`',b,re.M)))
assert len(cat)==6 and all(len(c['criteria']) in [3,4] for c in cat)
Path('web/lib/workflow-catalog.mjs').write_text('// Frozen starter briefs from docs/workflow-template-spec.md. No executor implied.\nexport const CATALOG = '+json.dumps(cat,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
print('Generated six frozen catalog definitions')
