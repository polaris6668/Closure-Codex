export function mountTheme({document:doc,css,revision}) {
  const key='__closureWorkbuddyTheme',attribute='data-closure-workbuddy-theme'
  const win=doc.defaultView,root=doc.documentElement
  if(win[key]?.revision===revision)return win[key]
  win[key]?.dispose()
  const previous=root.getAttribute(attribute)
  const previousWidth=[root.style.getPropertyValue('--closure-workbuddy-menu-width'),root.style.getPropertyPriority('--closure-workbuddy-menu-width')]
  const modes=['light','cb-light','vscode-light','dark','cb-dark','vscode-dark']
  const originals=[root,doc.body].map(node=>({node,classes:new Map(modes.map(name=>[name,node.classList.contains(name)]))}))
  const originalAttributes=[[root,'data-theme'],[doc.body,'data-vscode-theme-kind'],[doc.body,'data-vscode-theme-name'],[doc.body,'data-theme-source']].map(([node,name])=>[node,name,node.getAttribute(name)])
  let scheme=[root.style.colorScheme,root.style.getPropertyPriority('color-scheme')]
  function selectDark(remember=false) {
    if(root.getAttribute('data-theme')==='dark'&&doc.body.getAttribute('data-vscode-theme-kind')==='vscode-dark'&&doc.body.getAttribute('data-theme-source')==='dark'&&root.classList.contains('dark')&&doc.body.classList.contains('dark'))return
    if(remember){
      for(const original of originals)original.classes=new Map(modes.map(name=>[name,original.node.classList.contains(name)]))
      for(const original of originalAttributes)original[2]=original[0].getAttribute(original[1])
      scheme=[root.style.colorScheme,root.style.getPropertyPriority('color-scheme')]
    }
    root.classList.remove('light','cb-light','vscode-light');doc.body.classList.remove('light','cb-light','vscode-light')
    root.classList.add('dark','cb-dark','vscode-dark');doc.body.classList.add('dark','cb-dark','vscode-dark')
    root.setAttribute('data-theme','dark')
    doc.body.setAttribute('data-vscode-theme-kind','vscode-dark')
    doc.body.setAttribute('data-vscode-theme-name','IDE Night')
    doc.body.setAttribute('data-theme-source','dark')
    root.style.colorScheme='dark'
  }
  selectDark()
  const style=doc.createElement('style')
  style.dataset.plugin='workbuddy-closure-codex-theme'
  style.textContent=css
  doc.head.append(style)
  root.setAttribute(attribute,'on')
  let disposed=false,queued=false,sidebar,frame=null
  function measure() {
    frame=null
    if(disposed)return
    const next=doc.querySelector('[data-view-id="sidebar"]')
    if(next!==sidebar){resize.disconnect();sidebar=next;if(sidebar)resize.observe(sidebar)}
    const box=sidebar?.getBoundingClientRect()
    const width=box&&box.right>0&&box.left<win.innerWidth ? Math.max(0,Math.min(box.right,box.width)):0
    const value=`${width}px`
    if(root.style.getPropertyValue('--closure-workbuddy-menu-width')!==value)root.style.setProperty('--closure-workbuddy-menu-width',value)
  }
  const resize=new win.ResizeObserver(()=>{if(frame===null)frame=win.requestAnimationFrame(measure)})
  function refresh() {
    queued=false
    if(disposed)return
    if(!style.isConnected)doc.head.append(style)
    selectDark(true)
    measure()
  }
  const observer=new win.MutationObserver(records=>{
    if(disposed||queued||!records.some(r=>r.type==='childList'||r.target===sidebar||r.target===root||r.target===doc.body))return
    queued=true
    win.queueMicrotask(refresh)
  })
  observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','data-layout-mode']})
  observer.observe(doc.head,{childList:true})
  observer.observe(root,{attributes:true,attributeFilter:['data-theme','class']})
  observer.observe(doc.body,{attributes:true,attributeFilter:['data-vscode-theme-kind','data-theme-source','class']})
  win.addEventListener('resize',measure)
  const controller={revision,snapshot:()=>({installed:style.isConnected,sidebar:!!sidebar,menu:!!doc.querySelector('#workbuddy-menubar-container'),width:root.style.getPropertyValue('--closure-workbuddy-menu-width')}),dispose(){
    if(disposed)return
    disposed=true;observer.disconnect();resize.disconnect();win.removeEventListener('resize',measure)
    if(frame!==null)win.cancelAnimationFrame(frame)
    style.remove()
    if(previous===null)root.removeAttribute(attribute);else root.setAttribute(attribute,previous)
    for(const {node,classes} of originals)for(const [name,present]of classes)node.classList.toggle(name,present)
    for(const [node,name,value]of originalAttributes)if(value===null)node.removeAttribute(name);else node.setAttribute(name,value)
    if(scheme[0])root.style.setProperty('color-scheme',...scheme);else root.style.removeProperty('color-scheme')
    if(previousWidth[0])root.style.setProperty('--closure-workbuddy-menu-width',...previousWidth);else root.style.removeProperty('--closure-workbuddy-menu-width')
    if(win[key]===controller)delete win[key]
  }}
  win[key]=controller
  refresh()
  return controller
}
