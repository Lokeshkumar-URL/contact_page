import { useEffect, useState } from 'react';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';

const emptyRegistry={pending:[],approved:[],dismissed:[]};

export default function FieldMappingRegistry(){
  const [registry,setRegistry]=useState(emptyRegistry);const [drafts,setDrafts]=useState({});const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  async function refresh(){setLoading(true);setError('');try{setRegistry(await apiRequest('/field-mappings'));}catch(reason){setError(getOperatorErrorMessage(reason));}finally{setLoading(false);}}
  useEffect(()=>{void refresh();},[]);
  function updateDraft(id,field,value){setDrafts((current)=>({...current,[id]:{scope:'website',aliases:'',...current[id],[field]:value}}));}
  async function approve(mapping){const draft={scope:'website',aliases:'',...drafts[mapping.id]};if(!draft.value?.trim()){setError(`Enter an approved value for ${mapping.fieldName}.`);return;}setError('');try{await apiRequest(`/field-mappings/${mapping.id}/approve`,{method:'POST',body:JSON.stringify(draft)});await refresh();}catch(reason){setError(getOperatorErrorMessage(reason));}}
  async function dismiss(mapping){setError('');try{await apiRequest(`/field-mappings/${mapping.id}/dismiss`,{method:'POST'});await refresh();}catch(reason){setError(getOperatorErrorMessage(reason));}}
  return <section className="configuration-form mapping-registry" aria-labelledby="mapping-registry-title">
    <div className="form-section-heading"><div><span className="section-number">06</span><h2 id="mapping-registry-title">Detected field suggestions</h2><p>Unknown safe fields found during runs appear here. Review and approve a value before automation may use them.</p></div><button className="secondary-button" type="button" onClick={refresh} disabled={loading}>Refresh</button></div>
    {error&&<p className="control-error" role="alert">{error}</p>}
    {loading?<p className="empty-mappings" role="status">Loading detected fields…</p>:registry.pending.length===0?<p className="empty-mappings">No pending field suggestions.</p>:<div className="mapping-list">{registry.pending.map((mapping)=>{const draft={scope:'website',aliases:'',...drafts[mapping.id]};return <article className="mapping-card" key={mapping.id}>
      <div className="mapping-card-heading"><div><strong>{mapping.fieldName}</strong><small>{mapping.domain} · {mapping.fieldType||'field'} · seen {mapping.seenCount} time{mapping.seenCount===1?'':'s'}</small></div><span className="status-badge status-manual_review">Pending approval</span></div>
      {mapping.options?.length>0&&<div className="mapping-options"><small>Available options</small><div>{mapping.options.map((option)=><span key={option}>{option}</span>)}</div></div>}
      <div className="mapping-editor">
        <label className="field"><span>Approved value</span><input value={draft.value??''} onChange={(event)=>updateDraft(mapping.id,'value',event.target.value)} placeholder="Enter exact value or option" /></label>
        <label className="field"><span>Alternative names</span><input value={draft.aliases} onChange={(event)=>updateDraft(mapping.id,'aliases',event.target.value)} placeholder="Comma-separated aliases" /></label>
        <label className="field"><span>Scope</span><select value={draft.scope} onChange={(event)=>updateDraft(mapping.id,'scope',event.target.value)}><option value="website">This website only</option><option value="global">All websites</option></select></label>
      </div>
      <div className="mapping-actions"><button className="secondary-button" type="button" onClick={()=>dismiss(mapping)}>Dismiss</button><button className="primary-button" type="button" onClick={()=>approve(mapping)}>Approve mapping</button></div>
    </article>;})}</div>}
    <div className="approved-mappings"><h3>Approved mappings</h3>{registry.approved.length===0?<p className="empty-mappings">No backend mappings approved yet.</p>:<div className="approved-mapping-grid">{registry.approved.map((mapping)=><div key={mapping.id}><strong>{mapping.fieldName}</strong><span>{mapping.value}</span><small>{mapping.scope==='global'?'All websites':mapping.domain}</small></div>)}</div>}</div>
  </section>;
}
