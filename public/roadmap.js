const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Dependencies are topic keys scoped to a proposal, never inferred from task order.
export function roadmapModel(state,goalId){
 const nodes=[],byKey=new Map(),sessions=state.sessions.filter(s=>s.goal_id===goalId&&s.status!=='REMOVED_FROM_PLAN');
 for(const s of sessions){const p=state.proposals.find(p=>p.id===s.proposal_id),item=p?.items[s.position],detail=state.learning?.session_details.find(d=>d.session_id===s.id),structured=Boolean(item?.key),key=structured?JSON.stringify([s.proposal_id,item.key]):s.id;
  let node=byKey.get(key);if(!node){node={key,title:item?.topic||detail?.topic||s.title,phase:item?.phase||detail?.phase||'未分组',dependencies:structured?(item.dependencies||[]).map(d=>JSON.stringify([s.proposal_id,d])):[],structured,sessions:[],rank:0};nodes.push(node);byKey.set(key,node);}node.sessions.push(s);
 }
 const edges=[];for(const n of nodes)for(const d of n.dependencies)if(byKey.has(d))edges.push({from:d,to:n.key});
 const done=new Set(),visiting=new Set();function rank(n){if(done.has(n.key))return n.rank;if(visiting.has(n.key))return 0;visiting.add(n.key);n.rank=Math.max(0,...n.dependencies.filter(d=>byKey.has(d)).map(d=>rank(byKey.get(d))+1));visiting.delete(n.key);done.add(n.key);return n.rank;}nodes.forEach(rank);
 return {nodes,edges};
}
export function roadmapView(state,goalId){
 const {nodes,edges}=roadmapModel(state,goalId);if(!nodes.length)return '';
 const indexes=new Map(nodes.map((node,i)=>[node.key,i]));
 const lines=edges.map(({from,to})=>`<path data-from="${indexes.get(from)}" data-to="${indexes.get(to)}" fill="none" stroke="#7893c6" stroke-width="2" stroke-linejoin="round" marker-end="url(#road-arrow)"/>`).join('');
 const cards=nodes.map(n=>`<section class="roadmap-node" data-rank="${n.rank}"><span class="sectionlabel">${esc(n.phase)}</span><h3>${esc(n.title)}</h3><p class="roadmap-deps">先修：${esc(n.dependencies.map(key=>nodes[indexes.get(key)]?.title||'未在当前路线显示的主题').join('、')||'未设置')}</p>${n.sessions.map(s=>`<button class="roadmap-task" data-action="detail-session" data-id="${esc(s.id)}"><span>${esc(s.title)}</span><small>${({PLANNED:'待学习',ASSESSING:'考察中',COMPLETED:'已完成'})[s.status]||esc(s.status)}</small></button>`).join('')}</section>`).join('');
 return `<section class="panel roadmap-panel"><div class="panelhead"><div><h2>学习路线图</h2><p class="help">箭头从先修主题指向后续主题。点击任务可查看详情，滚动可查看完整路线。</p></div><span class="badge">${nodes.length} 个主题 · ${edges.length} 条依赖</span></div>${nodes.some(n=>!n.structured)?'<p class="help">部分旧任务没有结构化依赖，仅展示节点，不按排列顺序补连线。</p>':''}${!edges.length?'<p class="help">当前可见任务之间没有已保存的依赖连线，不代表必须依次学习。</p>':''}<div class="roadmap-scroll" tabindex="0" aria-label="学习路线依赖图，可滚动"><div class="roadmap-canvas"><svg aria-hidden="true"><defs><marker id="road-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#7893c6"/></marker></defs>${lines}</svg>${cards}</div></div></section>`;
}
export function layoutRoadmap(root){
 const canvas=root.querySelector('.roadmap-canvas');if(!canvas)return;
 const svg=canvas.querySelector('svg');
 const nodes=[...canvas.querySelectorAll('.roadmap-node')].map(el=>({el,rank:Number(el.dataset.rank),incoming:[],outgoing:[]}));
 const edges=[...svg.querySelectorAll('[data-from]')].map(el=>({el,from:nodes[Number(el.dataset.from)],to:nodes[Number(el.dataset.to)]}));
 for(const edge of edges){edge.from.outgoing.push(edge);edge.to.incoming.push(edge);}
 // A long edge travels above the cards, using the gaps beside its two columns.
 const spanning=edges.filter(({from,to})=>to.rank!==from.rank+1);
 spanning.forEach((edge,i)=>{edge.lane=i+1;});
 const pad=24,columnGap=48,rowGap=24,laneGap=12,portGap=20;
 for(const {el,incoming,outgoing} of nodes){
  const ports=Math.max(1,incoming.length,outgoing.length);
  el.style.minHeight=36+(ports-1)*portGap+'px';
 }
 for(const node of nodes){
  const {width,height}=node.el.getBoundingClientRect();
  node.width=width;node.height=height;
 }
 const columnWidth=Math.max(...nodes.map(n=>n.width));
 const top=pad+spanning.length*laneGap,rows=new Map();
 let right=0,bottom=0;
 for(const node of nodes){
  node.x=pad+node.rank*(columnWidth+columnGap);
  node.y=rows.get(node.rank)??top;
  rows.set(node.rank,node.y+node.height+rowGap);
  right=Math.max(right,node.x+node.width);bottom=Math.max(bottom,node.y+node.height);
  node.el.style.left=node.x+'px';node.el.style.top=node.y+'px';
 }
 const width=Math.ceil(right+pad),height=Math.ceil(bottom+pad);
 canvas.style.width=width+'px';canvas.style.height=height+'px';
 svg.setAttribute('width',width);svg.setAttribute('height',height);
 // Keep the top bypasses above the direct links and give every arrow its own endpoint.
 const direct=spanning.length+1,byLane=(a,b)=>(a.lane??direct)-(b.lane??direct);
 const center=node=>node.y+node.height/2;
 const portY=(node,i,count)=>center(node)+(i-(count-1)/2)*portGap;
 for(const node of nodes){
  node.incoming.sort((a,b)=>byLane(a,b)||center(a.from)-center(b.from));
  node.outgoing.sort((a,b)=>byLane(a,b)||center(a.to)-center(b.to));
  node.incoming.forEach((edge,i)=>{edge.endY=portY(node,i,node.incoming.length);});
  node.outgoing.forEach((edge,i)=>{edge.startY=portY(node,i,node.outgoing.length);});
 }
 for(const {el,from,to,lane,startY,endY} of edges){
  const x=from.x+from.width,end=to.x-5;
  if(lane){
   const inset=8+12*lane/(spanning.length+1),laneY=top-laneGap*lane;
   el.setAttribute('d',`M${x},${startY} H${x+inset} V${laneY} H${to.x-inset} V${endY} H${end}`);
  }else{
   const bend=(end-x)/2;
   el.setAttribute('d',`M${x},${startY} C${x+bend},${startY} ${end-bend},${endY} ${end},${endY}`);
  }
 }
}
