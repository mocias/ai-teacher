const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('teacherDesktop',{
 openReader:resourceId=>ipcRenderer.invoke('reader:open',resourceId),
 command:(action,args={})=>ipcRenderer.invoke('reader:command',action,args),
 onOpenReader:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('reader:open-request',listener);return ()=>ipcRenderer.removeListener('reader:open-request',listener);},
 onState:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('reader:state',listener);return ()=>ipcRenderer.removeListener('reader:state',listener);},
 onSelection:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('reader:selection',listener);return ()=>ipcRenderer.removeListener('reader:selection',listener);}
});
