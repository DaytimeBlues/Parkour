/** Explicit, ephemeral development opt-in. Never reads or writes saved looks. */
export function skinPreviewOptions(base:string,development:boolean,search:string):{characterAssetBase?:string}{
 if(!development)return{};
 const preview=new URLSearchParams(search).get('appearancePreview');
 if(preview==='continuous-skin')return{characterAssetBase:`${base}__skin-preview/`};
 if(preview==='woodland-art')return{characterAssetBase:`${base}__woodland-preview/`};
 if(preview==='woodland-face')return{characterAssetBase:`${base}__woodland-face-preview/`};
 return{};
}

/** A visible warning prevents local candidate captures being mistaken for release. */
export function showSkinPreviewNotice(active:boolean){
 if(!active||document.getElementById('skin-preview-notice'))return;
 const notice=document.createElement('aside');notice.id='skin-preview-notice';notice.setAttribute('role','status');
 notice.textContent='LOCAL GRAPHICS CANDIDATE · artwork, browser and device acceptance pending';
 Object.assign(notice.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'10000',padding:'5px 10px',background:'#3e2459',color:'#fff',font:'12px system-ui',pointerEvents:'none'});
 document.body.append(notice);
}
