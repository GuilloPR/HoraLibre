import {firebaseConfig} from './firebase-config.js';
const root=()=>document.getElementById('googleAccount');
const bridge=()=>window.HoraLibreCloudBridge;
const configured=()=>firebaseConfig.apiKey&&!firebaseConfig.apiKey.startsWith('PEGAR_')&&firebaseConfig.projectId&&!firebaseConfig.projectId.startsWith('PEGAR_');
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const status=s=>{const el=document.getElementById('syncLabel');if(el)el.textContent=s};
const canonical=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,key)=>(o[key]=x[key],o),{}):x);
const snapshot=()=>canonical(bridge()?.read()||{});
let auth,db,user=null,cloudRev=null,baseline=null,dirty=false,busy=false,authReady=false,mode='off',timer=null,unsubscribe=null,applying=false,initialized=false;
let firestore;
function ui(){const el=root();if(!el)return;
 if(!configured()){el.innerHTML='<div class="status warn">Falta configurar firebase-config.js.</div>';return}
 if(!authReady){el.innerHTML='<div class="note">Conectando con Firebase…</div>';return}
 if(!user){el.innerHTML='<button class="btn" id="googleLogin">Iniciar sesión con Google</button><div class="note">Los registros permanecen en este dispositivo hasta que inicies sesión.</div>';document.getElementById('googleLogin').onclick=login;return}
 const labels={ready:'Sincronización automática activada. Los cambios se guardan en Google cuando hay conexión.',conflict:'⚠ Hay diferencias entre este dispositivo y Google. La sincronización está detenida para evitar pérdidas.',offline:'Sin conexión. Los cambios quedan guardados aquí y se sincronizarán al reconectar.',error:'No se pudo sincronizar. Conservamos los datos locales; volvé a intentar.',off:'Comprobando el estado de la cuenta…'};
 el.innerHTML=`<div class="card"><b>Conectado: ${safe(user.displayName||user.email)}</b><span class="small">${safe(user.email)}</span><div class="note">${labels[mode]||labels.off}</div><div class="note">${dirty?'Hay cambios locales pendientes.':'Tus registros locales se conservan en este dispositivo.'}</div><button class="btn" id="googleUpload">${mode==='conflict'?'Usar datos de este dispositivo (reemplazar nube)':'Guardar mis datos en Google ahora'}</button><button class="btn secondary" id="googleDownload">Recuperar datos de Google</button><button class="btn ghost" id="googleLogout">Cerrar sesión</button></div>`;
 document.getElementById('googleUpload').onclick=upload;document.getElementById('googleDownload').onclick=download;document.getElementById('googleLogout').onclick=()=>auth.signOut();
}
async function login(){try{const {GoogleAuthProvider,signInWithPopup,signInWithRedirect}=await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){if(e.code==='auth/popup-blocked')await signInWithRedirect(auth,new GoogleAuthProvider());else throw e}}catch(e){bridge()?.notify('No se pudo iniciar sesión: '+(e.code||e.message))}}
async function getRemote(){const snap=await firestore.getDoc(firestore.doc(db,'users',user.uid));return snap.exists()?snap.data():null}
function markConflict(){mode='conflict';clearTimeout(timer);status('⚠ Datos distintos: revisá Cuenta y respaldo');ui()}
function markReady(remote){cloudRev=remote?.revision||null;baseline=snapshot();dirty=false;mode=navigator.onLine?'ready':'offline';status(navigator.onLine?'● Google conectado · Sincronización automática':'● Sin conexión · Datos locales protegidos');ui()}
async function refresh(){if(!user||busy||mode==='conflict')return;try{const remote=await getRemote();if((remote?.revision||null)!==(cloudRev||null)){if(remote?.state&&canonical(remote.state)===snapshot()){markReady(remote);return}markConflict();return}if(mode==='offline'&&navigator.onLine){mode='ready';ui();if(dirty)schedule()}}catch(e){mode=navigator.onLine?'error':'offline';status('● Datos locales · Sin sincronizar');ui()}}
async function push({manual=false,overwrite=false}={}){if(!user||busy||!navigator.onLine)return; if(!manual&&mode!=='ready')return;
 busy=true;clearTimeout(timer);const before=snapshot();try{
  const next=crypto.randomUUID();await firestore.runTransaction(db,async tx=>{const ref=firestore.doc(db,'users',user.uid),snap=await tx.get(ref),current=snap.exists()?snap.data():null;
   if(!overwrite&&(current?.revision||null)!==(cloudRev||null))throw Error('CONFLICTO');
   tx.set(ref,{state:JSON.parse(before),revision:next,updatedAt:firestore.serverTimestamp()});
  });
  cloudRev=next;baseline=before;dirty=snapshot()!==before;mode='ready';status('● Google sincronizado');if(manual)bridge()?.notify('Copia guardada en Google');
 }catch(e){if(e.message==='CONFLICTO'){markConflict();bridge()?.notify('Hay otra versión en Google. No se sobrescribió.')}else{mode=navigator.onLine?'error':'offline';status('● Datos locales · Sin sincronizar');if(manual)bridge()?.notify('No se pudo guardar: '+(e.message||e.code))}}
 finally{busy=false;ui();if(dirty&&mode==='ready')schedule()}}
function schedule(){clearTimeout(timer);if(!user||mode!=='ready')return;timer=setTimeout(()=>push(),1800)}
async function upload(){if(!user||busy)return;try{const remote=await getRemote();const conflict=mode==='conflict'||(remote?.revision||null)!==(cloudRev||null);
 if(conflict){if(!confirm('ATENCIÓN: los registros de este dispositivo y los de Google son distintos. Si continuás, reemplazarás la copia de Google. ¿Ya descargaste un respaldo de ambos?'))return;if(!confirm('Última confirmación: ¿reemplazar la copia de Google por los datos de ESTE dispositivo?'))return;await push({manual:true,overwrite:true});return}
 if(!confirm('¿Guardar ahora los registros de este dispositivo en Google?'))return;await push({manual:true});
 }catch(e){bridge()?.notify('No se pudo consultar Google: '+(e.message||e.code))}}
async function download(){if(!user||busy)return;busy=true;try{const remote=await getRemote();if(!remote?.state){bridge()?.notify('Todavía no hay datos en Google');return}
 if(!confirm('¿Reemplazar los registros de ESTE dispositivo por los de Google? Antes descargá una copia de seguridad si tenés cambios locales.'))return;
 applying=true;bridge().replace(remote.state);applying=false;markReady(remote);bridge()?.notify('Datos recuperados de Google');
 }catch(e){bridge()?.notify('No se pudieron recuperar los datos: '+(e.message||e.code))}finally{applying=false;busy=false;ui()}}
async function startSession(u){clearTimeout(timer);if(unsubscribe){unsubscribe();unsubscribe=null}user=u;cloudRev=null;baseline=null;dirty=false;mode='off';authReady=true;if(!u){status('● Datos guardados en este dispositivo');ui();return}
 try{const remote=await getRemote();const local=snapshot();if(remote?.state&&canonical(remote.state)!==local){markConflict()}else{markReady(remote)}
  unsubscribe=firestore.onSnapshot(firestore.doc(db,'users',u.uid),snap=>{if(user?.uid!==u.uid||!initialized||busy)return;const remoteData=snap.exists()?snap.data():null;if((remoteData?.revision||null)===(cloudRev||null))return;
   if(remoteData?.state&&canonical(remoteData.state)===snapshot()){markReady(remoteData);return}
   if(mode==='ready'&&!dirty&&baseline===snapshot()&&remoteData?.state){applying=true;try{bridge().replace(remoteData.state);markReady(remoteData);status('● Cambios recibidos desde Google')}finally{applying=false}}
   else markConflict();
  },()=>{if(mode!=='conflict'){mode='error';status('● No se pudo comprobar la nube');ui()}});
  initialized=true;
 }catch(e){mode=navigator.onLine?'error':'offline';status('● Datos locales · Error al consultar Google');ui()}}
window.addEventListener('horalibre:account-open',ui);
window.addEventListener('horalibre:changed',()=>{if(applying||!user)return;dirty=true;if(mode==='ready'){status('● Guardando cambios en Google…');schedule()}else{status('● Cambios locales · Pendientes de sincronizar')}ui()});
window.addEventListener('online',()=>{if(mode==='offline'||mode==='error')refresh()});
window.addEventListener('focus',()=>{if(user&&mode!=='conflict')refresh()});
if(configured()){try{const [{initializeApp},{getAuth,onAuthStateChanged,getRedirectResult},fs]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')]);firestore=fs;const app=initializeApp(firebaseConfig);auth=getAuth(app);db=fs.getFirestore(app);getRedirectResult(auth).catch(e=>bridge()?.notify('Google: '+e.message));onAuthStateChanged(auth,startSession)}catch(e){authReady=true;mode='error';status('● Datos locales · Error de Firebase');ui();console.error(e)}}else{authReady=true;ui()}
