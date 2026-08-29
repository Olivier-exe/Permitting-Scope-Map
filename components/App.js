'use client';
import {useState,useRef,useEffect,useCallback} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {runFullAnalysis,generatePermits,getElevation,reverseGeocode,haversine,bearing,polygonArea,polygonAreaMultiUnit,parseKML} from '../lib/spatial';

function timeAgo(iso){if(!iso)return'';var s=(Date.now()-new Date(iso).getTime())/1000;if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}

var PIN_COLORS = {
  review: {bg:'#e6a23c',label:'Needs Review'},
  approved: {bg:'#00d4aa',label:'Approved'},
  complete: {bg:'#4a9eff',label:'Complete'},
  issue: {bg:'#ff4d6a',label:'Issue'},
};

var REGIONS={entergy_la:{minLat:28.5,maxLat:33.2,minLng:-94.1,maxLng:-88.7},entergy_tx:{minLat:29.0,maxLat:31.5,minLng:-96.0,maxLng:-93.5},exel_nm:{minLat:31.3,maxLat:37.0,minLng:-109.1,maxLng:-103.0},exel_tx:{minLat:25.8,maxLat:36.5,minLng:-106.7,maxLng:-93.5},colorado:{minLat:36.9,maxLat:41.1,minLng:-109.1,maxLng:-102.0},florida:{minLat:24.5,maxLat:31.0,minLng:-87.6,maxLng:-80.0}};
var REGION_ORDER=['florida','colorado','entergy_la','entergy_tx','exel_nm','exel_tx'];
function detectRaw(lat,lng){for(var i=0;i<REGION_ORDER.length;i++){var b=REGIONS[REGION_ORDER[i]];if(lat>=b.minLat&&lat<=b.maxLat&&lng>=b.minLng&&lng<=b.maxLng)return REGION_ORDER[i];}return null;}

var BASEMAPS = {
  dark: {url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',attr:'OpenStreetMap',label:'Dark',maxZoom:21,maxNativeZoom:19,className:'dark-tiles'},
  hybrid: {url:'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',attr:'Google',label:'Hybrid',maxZoom:21},
  satellite: {url:'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',attr:'Google',label:'Satellite',maxZoom:21},
  esri: {url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attr:'ESRI',label:'ESRI',maxZoom:19},
  osm: {url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',attr:'OpenStreetMap',label:'Streets',maxZoom:19},
};

function airportIcon(){return L.divIcon({className:'',html:'<svg width="20" height="20" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0011.5 2 1.5 1.5 0 0010 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#06b6d4" stroke="#fff" stroke-width="0.5"/></svg>',iconSize:[20,20],iconAnchor:[10,10]});}
function Badge({label,value,color}){return <div style={{display:'inline-flex',alignItems:'center',gap:5,background:'var(--card)',padding:'4px 10px',borderRadius:4,margin:'0 5px 5px 0',fontSize:12}}><span style={{color:'var(--text3)'}}>{label}</span><span style={{fontWeight:600,fontFamily:'var(--mono)',color:color||'var(--text3)'}}>{value}</span></div>;}
function PermitCard({p}){var c=({Critical:'#ff4d6a',High:'#e6a23c',Medium:'#00d4aa',Low:'#706b63'})[p.priority]||'#10b981';return <div style={{borderLeft:'3px solid '+c,background:c+'14',padding:'12px 14px',borderRadius:'0 6px 6px 0',marginBottom:8}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}><span style={{fontWeight:700,fontSize:14}}>{p.type}</span><span style={{fontSize:10,fontWeight:700,color:c,border:'1px solid '+c+'40',padding:'2px 8px',borderRadius:20,textTransform:'uppercase'}}>{p.priority}</span></div><div style={{fontSize:12,color:'var(--text2)',marginBottom:4}}>{p.jurisdiction}</div><div style={{fontSize:13,color:'var(--text2)',lineHeight:1.5}}>{p.recommendation}</div>{p.notes&&<div style={{fontSize:12,color:'var(--amber)',marginTop:5,fontStyle:'italic'}}>{p.notes}</div>}</div>;}
function DetailBox({title,color,children}){return <div style={{borderRadius:6,padding:12,marginBottom:10,borderLeft:'3px solid '+color+'50',background:color+'0a'}}><div style={{fontWeight:700,marginBottom:5,fontSize:13,color:color}}>{title}</div>{children}</div>;}
function NearbyRow({label,dist,dir}){var ft=Math.round(dist*3.28084);var dc=ft<150?'var(--red)':ft<650?'var(--amber)':'var(--text2)';return <div style={{fontSize:12,marginBottom:4,display:'flex',justifyContent:'space-between',gap:8}}><span>{label}</span><b style={{color:dc,fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>{ft>5280?((ft/5280).toFixed(1)+' mi'):(ft+' ft')}{dir?' '+dir:''}</b></div>;}

var SL={fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)',marginBottom:6};
var BTN={fontSize:11,padding:'4px 10px',borderRadius:4,border:'1px solid var(--border)',background:'transparent',color:'var(--text3)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:500};

export default function App(){
  var [manifest,setManifest]=useState(null);
  var [company,setCompany]=useState(null);
  var [layerToggles,setLayerToggles]=useState({});
  var [layerOpacity,setLayerOpacity]=useState({});
  var [layerData,setLayerData]=useState({});
  var [loadingLayers,setLoadingLayers]=useState({});
  var [lookupData,setLookupData]=useState({});
  var [pts,setPts]=useState([]);
  var [selId,setSelId]=useState(null);
  var [selIds,setSelIds]=useState([]);
  var [res,setRes]=useState({});
  var [busy,setBusy]=useState(false);
  var [statusMsg,setStatusMsg]=useState('');
  var [pinMode,setPinMode]=useState(false);
  var [measureMode,setMeasureMode]=useState(false);
  var [measurePts,setMeasurePts]=useState([]);
  var [areaMode,setAreaMode]=useState(false);
  var [areaPts,setAreaPts]=useState([]);
  var [basemap,setBasemap]=useState('dark');
  /* ---- Share v2 (expiring links / project numbers). Server-controlled kill
     switch: /api/share reports enabled only when storage env vars are set.
     When off/absent, everything below is dormant and Share behaves as before.
     Removal: revert the share-links commit (tag pre-share-checkpoint). ---- */
  var [shareV2,setShareV2]=useState(false);
  var [shareOpen,setShareOpen]=useState(false);
  var [shareTtl,setShareTtl]=useState(30);
  var [shareBy,setShareBy]=useState('');
  var [shareBusy,setShareBusy]=useState(false);
  var [shareErr,setShareErr]=useState('');
  /* ---- Live projects (same enable flag + storage as Share v2) ---- */
  var [proj,setProj]=useState(null);
  var [projDirty,setProjDirty]=useState(false);
  var [projUpdate,setProjUpdate]=useState(null);
  var [projUpdateMin,setProjUpdateMin]=useState(false);
  var [projModal,setProjModal]=useState(false);
  var [projInput,setProjInput]=useState('');
  var [projName,setProjName]=useState('');
  var [projBusy,setProjBusy]=useState(false);
  var [projErr,setProjErr]=useState('');
  var [projConflict,setProjConflict]=useState(null);
  var [projMenu,setProjMenu]=useState(false);
  var [exportMenu,setExportMenu]=useState(false);
  var applyingProj=useRef(false);
  var bootProj=useRef(null);
  var importRef=useRef(null);
  var [err,setErr]=useState('');
  var [cursorCoords,setCursorCoords]=useState(null);
  var [zoomLevel,setZoomLevel]=useState(7);
  var [searchText,setSearchText]=useState('');
  var [showLegend,setShowLegend]=useState(false);
  var [leftWidth,setLeftWidth]=useState(340);
  var [rightWidth,setRightWidth]=useState(380);
  var [sideTab,setSideTab]=useState('locations');
  var [multiWarn,setMultiWarn]=useState(null);
  var nextId=useRef(1);
  var mapRef=useRef(null);
  var mapInst=useRef(null);
  var markersRef=useRef([]);
  var layerGroupsRef=useRef({});
  var tileRef=useRef(null);
  var fileRef=useRef(null);
  var kmlFileRef=useRef(null);
  var measureLineRef=useRef(null);
  var measureMarkersRef=useRef([]);
  var areaPolyRef=useRef(null);
  var areaMarkersRef=useRef([]);
  var projFileRef=useRef(null);
  var pinMeasureLinesRef=useRef([]);
  var resizingRef=useRef(null);
  var multiDismissRef=useRef('');

  // Auto-save session
  useEffect(function(){
    if(!pts.length&&!Object.keys(res).length)return;
    var timeout=setTimeout(function(){
      try{localStorage.setItem('psm_session',JSON.stringify({pts:pts,res:res,company:company,selId:selId,projId:proj?proj.id:null,projRev:proj?proj.rev:0,projDirty:projDirty}));}catch(e){}
    },1000);
    return function(){clearTimeout(timeout);};
  },[pts,res,company,selId,proj,projDirty]);

  // Restore session on mount
  useEffect(function(){
    try{var s=localStorage.getItem('psm_session');if(s){var d=JSON.parse(s);if(d.pts&&d.pts.length){setPts(d.pts);var maxId=0;d.pts.forEach(function(p){if(p.id>maxId)maxId=p.id;});nextId.current=maxId+1;}if(d.res)setRes(d.res);if(d.company)setCompany(d.company);if(d.selId)setSelId(d.selId);if(d.projId)bootProj.current={id:d.projId,rev:d.projRev||0,dirty:!!d.projDirty};}}catch(e){}
  },[]);

  // Resizable panels
  var startResize=useCallback(function(panel,e){
    e.preventDefault();resizingRef.current={panel:panel,startX:e.clientX,startW:panel==='left'?leftWidth:rightWidth};
    var onMove=function(ev){if(!resizingRef.current)return;var dx=ev.clientX-resizingRef.current.startX;
      if(resizingRef.current.panel==='left')setLeftWidth(Math.max(280,Math.min(560,resizingRef.current.startW+dx)));
      else setRightWidth(Math.max(280,Math.min(600,resizingRef.current.startW-dx)));};
    var onUp=function(){resizingRef.current=null;document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);document.body.style.cursor='';document.body.style.userSelect='';};
    document.body.style.cursor='col-resize';document.body.style.userSelect='none';
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  },[leftWidth,rightWidth]);

  useEffect(function(){
    fetch('/layers/manifest.json').then(function(r){return r.json();}).then(function(d){
      setManifest(d);var keys=Object.keys(d.companies);
      if(keys.length&&!company){setCompany(keys[0]);
        var tg={},op={};keys.forEach(function(k){tg[k]={};op[k]={};Object.keys(d.companies[k].layers).forEach(function(lk){tg[k][lk]=(lk==='dot'||lk==='rr');op[k][lk]=1;});});
        setLayerToggles(tg);setLayerOpacity(op);}
    });
  },[]);

  useEffect(function(){
    if(!manifest||!company)return;var co=manifest.companies[company];
    if(co.lookup&&!lookupData[company]){
      fetch('/layers/'+co.lookup).then(function(r){return r.json();}).then(function(d){
        setLookupData(function(p){var n=Object.assign({},p);n[company]=d;return n;});}).catch(function(){});
    }
  },[manifest,company,lookupData]);

  // Init map
  useEffect(function(){
    if(mapInst.current||!mapRef.current)return;
    var m=L.map(mapRef.current,{zoomControl:false,preferCanvas:true,minZoom:4,maxZoom:21}).setView([31,-92],7);
    L.control.zoom({position:'topright'}).addTo(m);
    tileRef.current=L.tileLayer(BASEMAPS.dark.url,{attribution:BASEMAPS.dark.attr,maxZoom:21,maxNativeZoom:BASEMAPS.dark.maxNativeZoom,className:BASEMAPS.dark.className||''}).addTo(m);
    m.on('contextmenu',function(e){e.originalEvent.preventDefault();
      if(m._measureMode){setMeasurePts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      if(m._areaMode){setAreaPts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      setPts(function(prev){return prev.concat([{id:nextId.current++,lat:e.latlng.lat,lng:e.latlng.lng,name:'Pin '+(nextId.current-1),color:'review',notes:''}]);});
    });
    m.on('click',function(e){
      if(m._measureMode){setMeasurePts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      if(m._areaMode){setAreaPts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      if(m._pinMode){setPts(function(prev){return prev.concat([{id:nextId.current++,lat:e.latlng.lat,lng:e.latlng.lng,name:'Pin '+(nextId.current-1),color:'review',notes:''}]);});m._pinMode=false;setPinMode(false);}
    });
    m.on('mousemove',function(e){setCursorCoords({lat:e.latlng.lat.toFixed(5),lng:e.latlng.lng.toFixed(5)});});
    m.on('mouseout',function(){setCursorCoords(null);});
    m.on('zoomend',function(){setZoomLevel(m.getZoom());});
    mapInst.current=m;return function(){m.remove();mapInst.current=null;};
  },[]);

  useEffect(function(){if(!mapInst.current||!tileRef.current)return;mapInst.current.removeLayer(tileRef.current);var bm=BASEMAPS[basemap];tileRef.current=L.tileLayer(bm.url,{attribution:bm.attr,maxZoom:bm.maxZoom||21,maxNativeZoom:bm.maxNativeZoom,className:bm.className||''}).addTo(mapInst.current);},[basemap]);
  useEffect(function(){if(!mapInst.current||!manifest||!company)return;var co=manifest.companies[company];if(co)mapInst.current.setView(co.center,co.zoom);},[company,manifest]);
  useEffect(function(){if(mapInst.current){mapInst.current._pinMode=pinMode;mapInst.current._measureMode=measureMode;mapInst.current._areaMode=areaMode;}},[pinMode,measureMode,areaMode]);
  useEffect(function(){var h=function(e){if(e.key==='Escape'){setPinMode(false);setMeasureMode(false);setMeasurePts([]);setAreaMode(false);setAreaPts([]);setSelIds([]);}};document.addEventListener('keydown',h);return function(){document.removeEventListener('keydown',h);};},[]);

  // Measure line
  useEffect(function(){
    if(!mapInst.current)return;var m=mapInst.current;
    if(measureLineRef.current){m.removeLayer(measureLineRef.current);measureLineRef.current=null;}
    measureMarkersRef.current.forEach(function(mk){m.removeLayer(mk);});measureMarkersRef.current=[];
    if(measurePts.length>=2){
      measureLineRef.current=L.polyline(measurePts,{color:'#fff',weight:2,dashArray:'6 4'}).addTo(m);
      var total=0;for(var i=1;i<measurePts.length;i++){total+=haversine(measurePts[i-1][0],measurePts[i-1][1],measurePts[i][0],measurePts[i][1]);}
      var brng=bearing(measurePts[0][0],measurePts[0][1],measurePts[measurePts.length-1][0],measurePts[measurePts.length-1][1]);
      var totalFt=total*3.28084;var distStr=totalFt>5280?((totalFt/5280).toFixed(2)+' mi'):(Math.round(totalFt)+' ft');
      var mid=measurePts[Math.floor(measurePts.length/2)];
      var mk=L.marker(mid,{icon:L.divIcon({className:'',iconSize:null,html:'<div style="display:inline-block;background:rgba(0,0,0,0.9);color:#fff;padding:6px 12px;border-radius:6px;font-size:13px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(255,255,255,0.25);box-shadow:0 2px 8px rgba(0,0,0,0.5)">'+distStr+' | '+brng.toFixed(1)+'\u00b0</div>',iconAnchor:[70,-20]})}).addTo(m);
      measureMarkersRef.current.push(mk);
    }
    measurePts.forEach(function(pt){var mk=L.circleMarker(pt,{radius:5,color:'#fff',fillColor:'#fff',fillOpacity:1,weight:2}).addTo(m);measureMarkersRef.current.push(mk);});
  },[measurePts]);

  // Area polygon
  useEffect(function(){
    if(!mapInst.current)return;var m=mapInst.current;
    if(areaPolyRef.current){m.removeLayer(areaPolyRef.current);areaPolyRef.current=null;}
    areaMarkersRef.current.forEach(function(mk){m.removeLayer(mk);});areaMarkersRef.current=[];
    if(areaPts.length>=3){
      areaPolyRef.current=L.polygon(areaPts,{color:'#a855f7',weight:2,fillOpacity:0.15,dashArray:'6 4'}).addTo(m);
      var units=polygonAreaMultiUnit(areaPts);
      var center=areaPts.reduce(function(a,p){return[a[0]+p[0]/areaPts.length,a[1]+p[1]/areaPts.length];},[0,0]);
      var line1=units.acres.toFixed(2)+' ac';var line2=units.sqft>100000?(units.sqft/1000000).toFixed(2)+' M sq ft':Math.round(units.sqft).toLocaleString()+' sq ft';var line3=units.sqmi>=0.01?units.sqmi.toFixed(3)+' sq mi':'';
      var html='<div style="display:inline-block;background:rgba(0,0,0,0.9);color:#a855f7;padding:6px 10px;border-radius:6px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(168,85,247,0.4);line-height:1.6">'+line1+'<br><span style="color:#c4b5fd;font-size:11px">'+line2+'</span>'+(line3?'<br><span style="color:#c4b5fd;font-size:11px">'+line3+'</span>':'')+'</div>';
      var mk=L.marker(center,{icon:L.divIcon({className:'',iconSize:null,html:html,iconAnchor:[60,14]})}).addTo(m);
      areaMarkersRef.current.push(mk);
    }
    areaPts.forEach(function(pt){var mk=L.circleMarker(pt,{radius:5,color:'#a855f7',fillColor:'#a855f7',fillOpacity:1,weight:2}).addTo(m);areaMarkersRef.current.push(mk);});
  },[areaPts]);

  // Load layers
  useEffect(function(){
    if(!manifest||!company)return;var co=manifest.companies[company];var tg=layerToggles[company]||{};
    Object.keys(co.layers).forEach(function(lk){var dk=company+'_'+lk;
      if(tg[lk]&&!layerData[dk]&&!loadingLayers[dk]){
        setLoadingLayers(function(p){var n=Object.assign({},p);n[dk]=true;return n;});
        fetch('/layers/'+co.layers[lk].file).then(function(r){return r.json();}).then(function(data){
          setLayerData(function(p){var n=Object.assign({},p);n[dk]=data;return n;});setLoadingLayers(function(p){var n=Object.assign({},p);delete n[dk];return n;});
        }).catch(function(){setLoadingLayers(function(p){var n=Object.assign({},p);delete n[dk];return n;});});
      }
    });
  },[layerToggles,company,manifest,layerData,loadingLayers]);

  // Draw layers
  useEffect(function(){
    if(!mapInst.current||!manifest||!company)return;var m=mapInst.current;var co=manifest.companies[company];var tg=layerToggles[company]||{};var op=layerOpacity[company]||{};var lookup=lookupData[company]||{};
    Object.keys(layerGroupsRef.current).forEach(function(k){if(layerGroupsRef.current[k]){m.removeLayer(layerGroupsRef.current[k]);delete layerGroupsRef.current[k];}});
    Object.keys(co.layers).forEach(function(lk){
      var dk=company+'_'+lk;if(!tg[lk]||!layerData[dk])return;
      var cfg=co.layers[lk];var data=layerData[dk];var items=[];var opacity=(op[lk]!==undefined?op[lk]:1);
      if(cfg.minZoom&&m.getZoom()<cfg.minZoom){var zh=function(){var g=layerGroupsRef.current[dk];if(m.getZoom()>=cfg.minZoom){if(g&&!m.hasLayer(g))g.addTo(m);}else{if(g&&m.hasLayer(g))m.removeLayer(g);}};m.off('zoomend',zh);m.on('zoomend',zh);}
      if(cfg.type==='line'){
        data.forEach(function(seg){var ll=seg.c.map(function(p){return[p[0],p[1]];});if(ll.length<2)return;
          var clr=typeof cfg.color==='object'?(cfg.color[seg[cfg.colorKey]]||'#888'):cfg.color;
          var wt=typeof cfg.weight==='object'?(cfg.weight[seg[cfg.colorKey]]||2):(cfg.weight||2.5);
          var da=typeof cfg.dash==='object'?(cfg.dash[seg[cfg.colorKey]]||null):(cfg.dash||null);
          var line=L.polyline(ll,{color:clr,weight:wt,opacity:0.9*opacity,dashArray:da});
          var hitLine=L.polyline(ll,{color:clr,weight:Math.max(wt*3,12),opacity:0,interactive:true});
          var nm=seg[cfg.nameKey]||seg.n||seg.o||'';if(cfg.mpKey&&seg[cfg.mpKey])nm=nm+' \u00b7 MP '+seg[cfg.mpKey];
          if(nm){hitLine.bindTooltip(nm,{sticky:true,className:'ltip'});line.bindTooltip(nm,{sticky:true,className:'ltip'});}
          hitLine.on('mouseover',function(){line.setStyle({weight:wt+3,opacity:1});});
          hitLine.on('mouseout',function(){line.setStyle({weight:wt,opacity:0.9*opacity});});
          items.push(line);items.push(hitLine);});
      }else if(cfg.type==='point'){
        data.forEach(function(pt){var icon=cfg.icon==='airport'?airportIcon():L.divIcon({className:'',html:'<div style="width:8px;height:8px;background:'+cfg.color+';border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px '+cfg.color+';opacity:'+opacity+'"></div>',iconSize:[8,8],iconAnchor:[4,4]});
          var mk=L.marker([pt.lat,pt.lng],{icon:icon});if(pt.n)mk.bindTooltip(pt.n,{className:'ltip'});items.push(mk);});
      }else if(cfg.type==='polygon'){
        data.forEach(function(poly){var ll=poly.c.map(function(p){return[p[0],p[1]];});if(ll.length<3)return;
          var pg=L.polygon(ll,{color:cfg.color,weight:cfg.weight||1.5,fillOpacity:(cfg.fill||0)*opacity,dashArray:cfg.dash||null,opacity:0.8*opacity});
          if(poly.n){var tip='<b>'+poly.n+'</b>';
            if((lk==='parishes'||lk==='counties')&&lookup.parishToCities&&lookup.parishToCities[poly.n]){var cs=lookup.parishToCities[poly.n];tip='<b>'+poly.n+'</b><br><span style="color:#a0a0a0;font-size:11px">Cities: '+cs.slice(0,8).join(', ')+(cs.length>8?' +more':'')+'</span>';}
            if(lk==='cities'&&lookup.cityToParish&&lookup.cityToParish[poly.n]){tip='<b>'+poly.n+'</b><br><span style="color:#a0a0a0;font-size:11px">'+(co.name.indexOf('Louisiana')>=0?'Parish':'County')+': '+lookup.cityToParish[poly.n]+'</span>';}
            pg.bindTooltip(tip,{sticky:true,className:'ltip'});
            pg.on('mouseover',function(){pg.setStyle({weight:(cfg.weight||1.5)+2,fillOpacity:0.15,opacity:1});});
            pg.on('mouseout',function(){pg.setStyle({weight:cfg.weight||1.5,fillOpacity:(cfg.fill||0)*opacity,opacity:0.8*opacity});});
          }items.push(pg);});
      }
      if(items.length){var group=L.layerGroup(items);group.addTo(m);layerGroupsRef.current[dk]=group;}
    });
  },[layerToggles,company,manifest,layerData,layerOpacity,lookupData]);

  // Draw markers + pin measure
  useEffect(function(){
    if(!mapInst.current)return;var m=mapInst.current;
    markersRef.current.forEach(function(mk){m.removeLayer(mk);});markersRef.current=[];
    pinMeasureLinesRef.current.forEach(function(l){m.removeLayer(l);});pinMeasureLinesRef.current=[];
    pts.forEach(function(pt){
      var has=res[pt.id],isSel=selId===pt.id,isMulti=selIds.indexOf(pt.id)>=0,sz=isSel?22:isMulti?20:16;
      var clr=has?(PIN_COLORS[pt.color]||PIN_COLORS.review).bg:'#e6a23c';
      if(isSel)clr='#e8434f';else if(isMulti)clr='#4a9eff';
      var icon=L.divIcon({className:'cm',html:'<div style="width:'+sz+'px;height:'+sz+'px;background:'+clr+';border:3px solid #fff;border-radius:50%;box-shadow:0 0 '+(isSel?16:isMulti?12:8)+'px '+clr+',0 2px 6px rgba(0,0,0,.6);cursor:pointer"></div>',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
      var mk=L.marker([pt.lat,pt.lng],{icon:icon}).addTo(m).on('click',function(e){
        if(mapInst.current._measureMode){setMeasurePts(function(p){return p.concat([[pt.lat,pt.lng]]);});return;}
        if(e.originalEvent.shiftKey){setSelIds(function(prev){return prev.indexOf(pt.id)>=0?prev.filter(function(x){return x!==pt.id;}):prev.concat([pt.id]);});}
        else{setSelId(pt.id);setSelIds([]);}
      });
      mk.bindTooltip(pt.name,{permanent:false,direction:'top',offset:[0,-12],className:'ltip'});markersRef.current.push(mk);
      if(isSel&&has&&has.info&&has.info.dot&&has.info.dot.length&&has.info.dot[0].cp){
        var d0=has.info.dot[0];var cpp=d0.cp;
        var dl=L.polyline([[pt.lat,pt.lng],[cpp[0],cpp[1]]],{color:'#4a9eff',weight:2,dashArray:'4 4',opacity:0.9,interactive:false}).addTo(m);
        var dft=Math.round(d0.d*3.28084);var dstr=dft>5280?((dft/5280).toFixed(2)+' mi'):(dft+' ft');
        var dlbl=L.marker([(pt.lat+cpp[0])/2,(pt.lng+cpp[1])/2],{icon:L.divIcon({className:'',iconSize:null,html:'<div style="display:inline-block;background:rgba(0,0,0,0.9);color:#4a9eff;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(74,158,255,0.35);box-shadow:0 2px 8px rgba(0,0,0,0.5)">'+dstr+' '+(d0.dir||'')+' \u00b7 '+d0.n+' centerline'+(d0.w?' \u00b7 ~'+Math.max(0,Math.round(d0.d*3.28084-d0.w/2))+'ft EOP est.':'')+'</div>',iconAnchor:[80,-8]}),interactive:false}).addTo(m);
        pinMeasureLinesRef.current.push(dl);pinMeasureLinesRef.current.push(dlbl);
      }
    });
    if(selIds.length>=2){
      var selPts=selIds.map(function(id){return pts.find(function(p){return p.id===id;});}).filter(Boolean);
      for(var i=0;i<selPts.length-1;i++){var a=selPts[i],b=selPts[i+1];var dist=haversine(a.lat,a.lng,b.lat,b.lng);var distFt=Math.round(dist*3.28084);var distStr=distFt>5280?((distFt/5280).toFixed(2)+' mi'):(distFt+' ft');var brg=bearing(a.lat,a.lng,b.lat,b.lng);
        var line=L.polyline([[a.lat,a.lng],[b.lat,b.lng]],{color:'#4a9eff',weight:2,dashArray:'6 4',opacity:0.9}).addTo(m);
        var label=L.marker([(a.lat+b.lat)/2,(a.lng+b.lng)/2],{icon:L.divIcon({className:'',iconSize:null,html:'<div style="display:inline-block;background:rgba(0,0,0,0.9);color:#4a9eff;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(74,158,255,0.3)">'+distStr+' | '+brg.toFixed(1)+'\u00b0</div>',iconAnchor:[60,-10]}),interactive:false}).addTo(m);
        pinMeasureLinesRef.current.push(line);pinMeasureLinesRef.current.push(label);
      }
      if(selPts.length>=3){var td=0;for(var j=0;j<selPts.length-1;j++){td+=haversine(selPts[j].lat,selPts[j].lng,selPts[j+1].lat,selPts[j+1].lng);}var tf=Math.round(td*3.28084);var ts=tf>5280?((tf/5280).toFixed(2)+' mi'):(tf+' ft');var lp=selPts[selPts.length-1];
        var tl=L.marker([lp.lat,lp.lng],{icon:L.divIcon({className:'',iconSize:null,html:'<div style="display:inline-block;background:rgba(0,0,0,0.9);color:#fff;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:700;border:1px solid rgba(255,255,255,0.2)">Total: '+ts+'</div>',iconAnchor:[50,20]}),interactive:false}).addTo(m);pinMeasureLinesRef.current.push(tl);}
    }
  },[pts,selId,selIds,res]);

  // Handlers
  var handleCSV=useCallback(function(file){setErr('');var reader=new FileReader();reader.onload=function(e){var lines=e.target.result.trim().split(/\r?\n/);if(lines.length<2){setErr('Need 2+ rows');return;}var h=lines[0].split(',').map(function(s){return s.trim().toLowerCase().replace(/['"]/g,'');});var li=h.findIndex(function(x){return['lat','latitude','y'].indexOf(x)>=0;});var lo=h.findIndex(function(x){return['lng','lon','long','longitude','x'].indexOf(x)>=0;});var ni=h.findIndex(function(x){return['name','label','id','station','site','location','station_id'].indexOf(x)>=0;});if(li<0||lo<0){setErr('Need lat + lng columns');return;}nextId.current=1;var np=[];for(var i=1;i<lines.length;i++){var c=lines[i].split(',').map(function(s){return s.trim().replace(/['"]/g,'');});var la=parseFloat(c[li]),ln=parseFloat(c[lo]);if(!isNaN(la)&&!isNaN(ln))np.push({id:nextId.current++,lat:la,lng:ln,name:ni>=0&&c[ni]?c[ni]:'Point '+(np.length+1),color:'review',notes:''});}if(!np.length){setErr('No valid coordinates');return;}setPts(np);setRes({});setSelId(null);setSelIds([]);};reader.readAsText(file);if(fileRef.current)fileRef.current.value='';},[]);

  var loadJSZip=useCallback(function(){return new Promise(function(resolve,reject){if(window.JSZip){resolve(window.JSZip);return;}var script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';script.onload=function(){resolve(window.JSZip);};script.onerror=function(){reject();};document.head.appendChild(script);});},[]);

  var handleKMLFile=useCallback(function(file){setErr('');var name=file.name.toLowerCase();
    if(name.endsWith('.kmz')){loadJSZip().then(function(JSZip){var reader=new FileReader();reader.onload=function(e){JSZip.loadAsync(e.target.result).then(function(zip){var kf=zip.file(/\.kml$/i)[0];if(!kf){setErr('No KML in KMZ');return;}kf.async('string').then(function(text){var points=parseKML(text);if(!points||!points.length){setErr('No coordinates');return;}nextId.current=1;setPts(points.map(function(p){return{id:nextId.current++,lat:p.lat,lng:p.lng,name:p.name,color:'review',notes:''};}));setRes({});setSelId(null);setSelIds([]);});}).catch(function(){setErr('Failed to read KMZ');});};reader.readAsArrayBuffer(file);}).catch(function(){setErr('Could not load KMZ support');});
    }else{var reader=new FileReader();reader.onload=function(e){var points=parseKML(e.target.result);if(!points||!points.length){setErr('No coordinates');return;}nextId.current=1;setPts(points.map(function(p){return{id:nextId.current++,lat:p.lat,lng:p.lng,name:p.name,color:'review',notes:''};}));setRes({});setSelId(null);setSelIds([]);};reader.readAsText(file);}
    if(kmlFileRef.current)kmlFileRef.current.value='';
  },[]);

  var removePoint=useCallback(function(id){setPts(function(p){return p.filter(function(x){return x.id!==id;});});setRes(function(p){var n=Object.assign({},p);delete n[id];return n;});if(selId===id)setSelId(null);setSelIds(function(p){return p.filter(function(x){return x!==id;});});},[selId]);
  var updatePoint=useCallback(function(id,updates){setPts(function(p){return p.map(function(pt){return pt.id===id?Object.assign({},pt,updates):pt;});});},[]);

  // Cycle through analyzed points (Results navigator); flies map to the pin
  var cyclePoint=useCallback(function(dir){
    var list=pts.filter(function(p){return res[p.id];});
    if(!list.length)return;
    var idx=list.findIndex(function(p){return p.id===selId;});
    var next=idx<0?(dir>0?0:list.length-1):(idx+dir+list.length)%list.length;
    var pt=list[next];setSelId(pt.id);setSelIds([]);
    if(mapInst.current){var m=mapInst.current;var z=Math.round(m.getZoom());m.flyTo([pt.lat,pt.lng],z>=14?z:14,{duration:0.6});}
  },[pts,res,selId]);

  // Arrow keys cycle points while the Results tab is open (ignored while typing)
  useEffect(function(){
    var h=function(e){
      if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
      if(sideTab!=='results')return;
      var t=document.activeElement?document.activeElement.tagName:'';
      if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return;
      e.preventDefault();cyclePoint(e.key==='ArrowRight'?1:-1);
    };
    document.addEventListener('keydown',h);return function(){document.removeEventListener('keydown',h);};
  },[cyclePoint,sideTab]);

  var handleSearch=useCallback(function(){if(!searchText.trim()||!mapInst.current)return;
    var cm=searchText.trim().match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
    if(cm){var cla=parseFloat(cm[1]),cln=parseFloat(cm[2]);
      if(cla>=-90&&cla<=90&&cln>=-180&&cln<=180){
        setPts(function(p){return p.concat([{id:nextId.current++,lat:cla,lng:cln,name:cla.toFixed(5)+', '+cln.toFixed(5),color:'review',notes:''}]);});
        mapInst.current.setView([cla,cln],15);setSearchText('');setErr('');return;}
      setErr('Coordinates out of range');return;}
    fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(searchText)+'&limit=1').then(function(r){return r.json();}).then(function(data){if(data&&data.length){var r=data[0];var lat=parseFloat(r.lat),lng=parseFloat(r.lon);setPts(function(p){return p.concat([{id:nextId.current++,lat:lat,lng:lng,name:searchText,color:'review',notes:''}]);});mapInst.current.setView([lat,lng],13);setSearchText('');setErr('');}else{setErr('Location not found');}}).catch(function(){setErr('Search failed');});},[searchText]);

  var exportCSV=useCallback(function(){if(!pts.length)return;var lines=['name,latitude,longitude,color,notes,address,city,county,state,nearest_dot,nearest_rr,elevation_ft'];pts.forEach(function(pt){var r=res[pt.id];var info=r?r.info:null;lines.push([pt.name,pt.lat,pt.lng,pt.color||'',pt.notes||'',info?info.address||'':'',info?info.city||'':'',info?info.county||'':'',info?info.state||'':'',info&&info.dot.length?info.dot[0].n+' ('+info.dot[0].d+'m)':'',info&&info.rr.length?info.rr[0].o+' ('+info.rr[0].d+'m)':'',info&&info.elevation?info.elevation.ft.toFixed(1):''].map(function(v){return'"'+String(v).replace(/"/g,'""')+'"';}).join(','));});var blob=new Blob([lines.join('\n')],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='scope_analysis.csv';a.click();URL.revokeObjectURL(url);},[pts,res]);

  var exportKML=useCallback(function(){if(!pts.length)return;
    var kmlColors={review:'ff3ca2e6',approved:'ffaad400',complete:'ffff9e4a',issue:'ff6a4dff'};
    var esc=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
    var k=['<?xml version="1.0" encoding="UTF-8"?>','<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Permitting Scope Export</name>'];
    Object.keys(kmlColors).forEach(function(st){k.push('<Style id="'+st+'"><IconStyle><color>'+kmlColors[st]+'</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle><LabelStyle><scale>0.9</scale></LabelStyle></Style>');});
    pts.forEach(function(pt){var r=res[pt.id];var info=r?r.info:null;var d=[];
      d.push('Status: '+((PIN_COLORS[pt.color]||{}).label||pt.color));
      if(pt.notes)d.push('Notes: '+pt.notes);
      if(info){if(info.address)d.push('Address: '+info.address);if(info.county)d.push((info.state==='Louisiana'?'Parish':'County')+': '+info.county);if(info.city)d.push('City: '+info.city);if(info.elevation)d.push('Elevation: '+info.elevation.ft.toFixed(1)+' ft');
        if(r.pm&&r.pm.length)d.push('Permits: '+r.pm.map(function(p){return p.type+' ('+p.priority+')';}).join('; '));}
      k.push('<Placemark><name>'+esc(pt.name)+'</name><styleUrl>#'+(pt.color||'review')+'</styleUrl><description>'+esc(d.join('\n'))+'</description><Point><coordinates>'+pt.lng+','+pt.lat+',0</coordinates></Point></Placemark>');});
    k.push('</Document></kml>');
    var blob=new Blob([k.join('\n')],{type:'application/vnd.google-earth.kml+xml'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='scope_pins.kml';a.click();URL.revokeObjectURL(url);
  },[pts,res]);

  var saveProject=useCallback(function(){var blob=new Blob([JSON.stringify({pts:pts,res:res,company:company})],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='scope_project.json';a.click();URL.revokeObjectURL(url);},[pts,res,company]);

  var loadProject=useCallback(function(file){var reader=new FileReader();reader.onload=function(e){try{var proj=JSON.parse(e.target.result);if(proj.pts){nextId.current=1;proj.pts.forEach(function(p){if(p.id>=nextId.current)nextId.current=p.id+1;});setPts(proj.pts);}if(proj.res)setRes(proj.res);if(proj.company)setCompany(proj.company);}catch(ex){setErr('Invalid project file');}};reader.readAsText(file);},[]);

  var detectCompany=useCallback(function(lat,lng){if(!manifest)return company;var k=detectRaw(lat,lng);return (k&&manifest.companies[k])?k:company;},[manifest,company]);

  // Auto-switch company based on pin locations; warn on multi-territory
  useEffect(function(){
    if(!manifest||!pts.length){setMultiWarn(null);multiDismissRef.current='';return;}
    var found={};
    pts.forEach(function(p){var k=detectRaw(p.lat,p.lng);if(k&&manifest.companies[k])found[k]=(found[k]||0)+1;});
    var keys=Object.keys(found);
    if(keys.length===1){
      setMultiWarn(null);multiDismissRef.current='';
      if(keys[0]!==company){setCompany(keys[0]);setStatusMsg('Switched to '+manifest.companies[keys[0]].short+' (pin locations)');setTimeout(function(){setStatusMsg('');},2500);}
    }else if(keys.length>1){
      var sig=keys.sort().join(',');
      if(multiDismissRef.current!==sig)setMultiWarn({list:keys,counts:found});
    }else{setMultiWarn(null);}
  },[pts,manifest,company]);

  var analyzeAll=useCallback(async function(){
    if(!pts.length||!company||!manifest)return;setBusy(true);var newRes={};
    setStatusMsg('Loading layers...');
    var needed={};for(var i=0;i<pts.length;i++){var pc=detectCompany(pts[i].lat,pts[i].lng);var co=manifest.companies[pc];if(co){['dot','rr','transmission','levee','faa','cities','parishes','counties','row','parish_roads','orange_roads','osceola_roads','rr_crossings','blm','usfs','nps','usfws','dod','usbr'].forEach(function(lk){var dk=pc+'_'+lk;if(co.layers[lk]&&!layerData[dk]&&!needed[dk])needed[dk]={file:co.layers[lk].file};});}}
    var nk=Object.keys(needed);if(nk.length){var lr=await Promise.all(nk.map(function(dk){return fetch('/layers/'+needed[dk].file).then(function(r){return r.json();}).then(function(d){return{dk:dk,data:d};}).catch(function(){return null;});}));lr.forEach(function(r){if(r)setLayerData(function(p){var n=Object.assign({},p);n[r.dk]=r.data;return n;});});}
    setStatusMsg('Spatial analysis...');
    var local=[];for(var i=0;i<pts.length;i++){var pt=pts[i];var pc=detectCompany(pt.lat,pt.lng);var r=runFullAnalysis(pt.lat,pt.lng,layerData,pc,manifest);if(r)r.detectedCompany=pc;local.push({pt:pt,info:r});}
    setStatusMsg('Fetching elevation & addresses...');
    var final=await Promise.all(local.map(function(lr){if(!lr.info)return Promise.resolve(lr);return Promise.all([getElevation(lr.pt.lat,lr.pt.lng),reverseGeocode(lr.pt.lat,lr.pt.lng)]).then(function(r){if(r[0])lr.info.elevation=r[0];if(r[1])lr.info.address=r[1];return lr;});}));
    final.forEach(function(lr){newRes[lr.pt.id]={info:lr.info,pm:lr.info?generatePermits(lr.info):[]};});
    setRes(Object.assign({},newRes));setBusy(false);setStatusMsg('');if(pts.length&&!selId)setSelId(pts[0].id);
  },[pts,company,manifest,layerData,selId,detectCompany]);

  var getShareLink=useCallback(function(){if(!pts.length)return;var params=pts.map(function(p){return p.lat.toFixed(5)+','+p.lng.toFixed(5)+','+encodeURIComponent(p.name);}).join('|');navigator.clipboard.writeText(window.location.origin+'?pins='+params+'&co='+(company||'')).then(function(){setStatusMsg('Link copied!');setTimeout(function(){setStatusMsg('');},2000);});},[pts,company]);

  // Share v2: ask the server once whether expiring shares are enabled
  useEffect(function(){fetch('/api/share').then(function(r){return r.json();}).then(function(d){setShareV2(!!(d&&d.enabled));}).catch(function(){});},[]);

  var loadSharedPayload=useCallback(function(d){
    if(!d||!Array.isArray(d.pts)||!d.pts.length){setErr(d&&d.error?d.error:'Shared set not found');return;}
    nextId.current=1;
    setPts(d.pts.map(function(p){return{id:nextId.current++,lat:p.lat,lng:p.lng,name:p.name||'Pin',color:p.color||'review',notes:p.notes||''};}));
    setRes({});setSelId(null);setSelIds([]);
    if(d.company)setCompany(d.company);
    var days=d.secondsLeft?Math.max(1,Math.round(d.secondsLeft/86400)):null;
    setStatusMsg('Shared set: '+d.pts.length+' pts'+(d.by?' \u00b7 by '+d.by:'')+(d.project?' \u00b7 Proj '+d.project:'')+(days?' \u00b7 expires in '+days+'d':''));
    setTimeout(function(){setStatusMsg('');},8000);
  },[]);

  var createShareV2=useCallback(function(){
    if(!pts.length||shareBusy)return;setShareBusy(true);setShareErr('');
    fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      pts:pts.map(function(p){return{lat:p.lat,lng:p.lng,name:p.name,color:p.color,notes:p.notes};}),
      company:company||'',ttl:shareTtl,by:shareBy.trim()||undefined})})
    .then(function(r){return r.json();}).then(function(d){
      setShareBusy(false);
      if(d.error){setShareErr(d.error);return;}
      try{if(shareBy.trim())localStorage.setItem('psm_name',shareBy.trim());}catch(e){}
      var msg='Link copied \u00b7 expires '+new Date(d.expires).toLocaleDateString();
      navigator.clipboard.writeText(d.url).then(function(){setStatusMsg(msg);}).catch(function(){setStatusMsg(d.url);});
      setShareOpen(false);setTimeout(function(){setStatusMsg('');},6000);
    }).catch(function(){setShareBusy(false);setShareErr('Share failed \u2014 try again');});
  },[pts,company,shareTtl,shareBy,shareBusy]);

  useEffect(function(){try{var n=localStorage.getItem('psm_name')||'';if(n){setShareBy(n);setProjName(n);}}catch(e){}},[]);

  var applyProject=useCallback(function(d){
    applyingProj.current=true;
    nextId.current=1;
    setPts((d.pts||[]).map(function(p){return{id:nextId.current++,lat:p.lat,lng:p.lng,name:p.name||'Pin',color:p.color||'review',notes:p.notes||''};}));
    setRes({});setSelId(null);setSelIds([]);
    if(d.company)setCompany(d.company);
    setProj({id:d.id,rev:d.rev,by:d.by,savedAt:d.savedAt,secondsLeft:d.secondsLeft||15552000});
    setProjDirty(false);setProjUpdate(null);setProjUpdateMin(false);setProjConflict(null);
    setStatusMsg('Project '+d.id+': '+(d.pts||[]).length+' pts'+(d.by?' \u00b7 last save by '+d.by:''));
    setTimeout(function(){setStatusMsg('');},6000);
  },[]);

  // Any local point edit while in a project marks it dirty
  useEffect(function(){if(!proj)return;if(applyingProj.current){applyingProj.current=false;return;}setProjDirty(true);},[pts]);

  // Rejoin the session's project on boot (explicit ?s= / ?p= links win)
  useEffect(function(){
    if(!shareV2||!bootProj.current)return;
    var bp=bootProj.current;bootProj.current=null;
    var params=new URLSearchParams(window.location.search);
    if(params.get('s')||params.get('p'))return;
    fetch('/api/project?id='+encodeURIComponent(bp.id)).then(function(r){return r.json();}).then(function(d){
      if(!d||!d.found){setStatusMsg('Project '+bp.id+' has expired');setTimeout(function(){setStatusMsg('');},5000);return;}
      if(d.rev===bp.rev){setProj({id:d.id,rev:d.rev,by:d.by,savedAt:d.savedAt,secondsLeft:d.secondsLeft});setProjDirty(bp.dirty);}
      else{setProj({id:d.id,rev:bp.rev,by:d.by,savedAt:d.savedAt,secondsLeft:d.secondsLeft});setProjDirty(bp.dirty);setProjUpdate(d);setProjUpdateMin(false);}
    }).catch(function(){});
  },[shareV2]);

  // Poll for teammate saves every 30s while in a project (visible tab only)
  useEffect(function(){
    if(!proj||!shareV2)return;
    var t=setInterval(function(){
      if(document.visibilityState!=='visible')return;
      var known=projUpdate?projUpdate.rev:proj.rev;
      fetch('/api/project?id='+encodeURIComponent(proj.id)+'&rev='+known).then(function(r){return r.json();}).then(function(d){
        if(!d)return;
        if(d.found===false){setStatusMsg('Project '+proj.id+' no longer exists');setTimeout(function(){setStatusMsg('');},5000);setProj(null);setProjUpdate(null);return;}
        if(d.found&&d.rev>proj.rev&&(!projUpdate||d.rev>projUpdate.rev)){setProjUpdate(d);setProjUpdateMin(false);}
      }).catch(function(){});
    },30000);
    return function(){clearInterval(t);};
  },[proj,shareV2,projUpdate]);

  var projSave=useCallback(function(force){
    if(!proj||projBusy)return;setProjBusy(true);
    var nm=projName.trim();try{if(nm)localStorage.setItem('psm_name',nm);}catch(e){}
    fetch('/api/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:proj.id,pts:pts.map(function(p){return{lat:p.lat,lng:p.lng,name:p.name,color:p.color,notes:p.notes};}),company:company||'',by:nm,baseRev:proj.rev,force:!!force})})
    .then(function(r){return r.json();}).then(function(d){
      setProjBusy(false);
      if(d.conflict){setProjConflict(d);return;}
      if(d.error){setStatusMsg(d.error);setTimeout(function(){setStatusMsg('');},4000);return;}
      setProj(function(p){return p?{id:p.id,rev:d.rev,by:nm,savedAt:d.savedAt,secondsLeft:15552000}:p;});
      setProjDirty(false);setProjConflict(null);setProjUpdate(null);setProjUpdateMin(false);
      setStatusMsg('Saved to '+proj.id);setTimeout(function(){setStatusMsg('');},3000);
    }).catch(function(){setProjBusy(false);setStatusMsg('Save failed \u2014 try again');setTimeout(function(){setStatusMsg('');},4000);});
  },[proj,projBusy,projName,pts,company]);

  var projLoadLatest=useCallback(function(){
    if(projUpdate&&projUpdate.pts){applyProject(projUpdate);return;}
    if(!proj)return;
    fetch('/api/project?id='+encodeURIComponent(proj.id)).then(function(r){return r.json();}).then(function(d){if(d&&d.found)applyProject(d);}).catch(function(){});
  },[projUpdate,proj,applyProject]);

  var projOpenStart=useCallback(function(){
    var id=projInput.trim();if(!id||projBusy)return;setProjBusy(true);setProjErr('');
    var nm=projName.trim();try{if(nm)localStorage.setItem('psm_name',nm);}catch(e){}
    fetch('/api/project?id='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
      if(d.error){setProjErr(d.error);setProjBusy(false);return;}
      if(d.found){applyProject(d);setProjModal(false);setProjBusy(false);setProjInput('');return;}
      fetch('/api/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,pts:pts.map(function(p){return{lat:p.lat,lng:p.lng,name:p.name,color:p.color,notes:p.notes};}),company:company||'',by:nm,force:true})})
      .then(function(r){return r.json();}).then(function(s){
        setProjBusy(false);
        if(s.error){setProjErr(s.error);return;}
        setProj({id:s.id,rev:s.rev,by:nm,savedAt:s.savedAt,secondsLeft:15552000});
        setProjDirty(false);setProjModal(false);setProjInput('');
        setStatusMsg('Project '+s.id+' created \u00b7 '+pts.length+' pts');setTimeout(function(){setStatusMsg('');},5000);
      }).catch(function(){setProjBusy(false);setProjErr('Create failed');});
    }).catch(function(){setProjBusy(false);setProjErr('Lookup failed');});
  },[projInput,projBusy,projName,pts,company,applyProject]);

  var projLeave=useCallback(function(){setProj(null);setProjDirty(false);setProjUpdate(null);setProjConflict(null);setStatusMsg('Left project');setTimeout(function(){setStatusMsg('');},2500);},[]);

  var sharedLoadedRef=useRef(false);
  useEffect(function(){var params=new URLSearchParams(window.location.search);
    var sId=params.get('s'),pNum=params.get('p');
    if(sId||pNum){
      if(sharedLoadedRef.current)return;sharedLoadedRef.current=true;
      if(sId){fetch('/api/share?id='+encodeURIComponent(sId)).then(function(r){return r.json();}).then(loadSharedPayload).catch(function(){setErr('Could not load shared set');});}
      else{fetch('/api/project?id='+encodeURIComponent(pNum)).then(function(r){return r.json();}).then(function(d){if(d&&d.found)applyProject(d);else setErr(d&&d.error?d.error:'Project not found');}).catch(function(){setErr('Could not load project');});}
      return;}
    var pinStr=params.get('pins');var coStr=params.get('co');if(pinStr){setPts(pinStr.split('|').map(function(p){var parts=p.split(',');return{id:nextId.current++,lat:parseFloat(parts[0]),lng:parseFloat(parts[1]),name:decodeURIComponent(parts[2]||'Pin'),color:'review',notes:''};}));}if(coStr&&manifest)setCompany(coStr);},[manifest,loadSharedPayload,applyProject]);

  // Derived
  var sel=selId?res[selId]:null;var selPt=pts.find(function(p){return p.id===selId;});
  var co=manifest&&company?manifest.companies[company]:null;
  var tg=layerToggles[company]||{};var op=layerOpacity[company]||{};
  var anyLoading=Object.keys(loadingLayers).length>0;
  var totalPermits=Object.values(res).reduce(function(s,r){return s+(r.pm?r.pm.length:0);},0);

  /* ============================================================
     LAYOUT: "COMMAND CENTER" — LOCKED SPEC (do not change without
     explicit request from Olivier)
     - Single LEFT sidebar (resizable 280-560px, default 340):
       header (brand) > company pills + basemap pills > search >
       tab bar [LAYERS | LOCATIONS | RESULTS] > scrolling tab body >
       footer (tools row + import/export row)
     - RESULTS tab (per Olivier, 2026-08-27): sticky point navigator
       (prev/next + "N of M", arrow keys, flies map to pin) over ONE
       unified scroll: Location > Summary > Permits > Nearby >
       Status > Notes. NO sub-tabs.
     - NO top bar. NO bottom status bar.
     - Map fills remaining space. Floating: mode hints (top-left),
       analyze pill (bottom-center), status chip (bottom-right).
     ============================================================ */
  var SEC={padding:'10px 14px',borderBottom:'1px solid var(--glass-border)'};
  var PILL=function(on){return{fontSize:10,padding:'4px 10px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid '+(on?'transparent':'var(--glass-border)'),background:on?'linear-gradient(135deg,var(--accent),var(--accent2))':'rgba(255,255,255,0.04)',color:on?'#fff':'var(--muted)'};};
  var BMPILL=function(on){return{fontSize:10,padding:'4px 9px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid '+(on?'var(--accent)':'var(--glass-border)'),background:on?'rgba(232,67,79,0.12)':'rgba(255,255,255,0.04)',color:on?'var(--accent)':'var(--muted)'};};
  var FBTN={fontSize:10,padding:'5px 10px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.04)',color:'var(--muted)'};
  var PMENU={display:'block',width:'100%',textAlign:'left',fontSize:10.5,padding:'6px 9px',border:'none',background:'transparent',color:'var(--text)',cursor:'pointer',fontFamily:'var(--font)',borderRadius:6,fontWeight:600};
  var PLABEL={fontSize:8,letterSpacing:1.8,textTransform:'uppercase',color:'var(--muted)',fontWeight:800,margin:'0 2px 5px'};
  var ACCENTBTN={fontSize:10,fontWeight:700,color:'#fff',background:'linear-gradient(135deg,var(--accent),var(--accent2))',border:'none',borderRadius:8,padding:'6px 11px',cursor:'pointer',fontFamily:'var(--font)'};
  var NAVBTN={width:28,height:28,borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.04)',color:'var(--muted)',cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--font)',flexShrink:0,lineHeight:1,padding:0};

  return (
    <div style={{height:'100vh',display:'flex',overflow:'hidden'}}>
      {/* ================= SIDEBAR ================= */}
      <div style={{width:leftWidth,background:'var(--surface)',borderRight:'1px solid var(--glass-border)',display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}}>
        {/* Brand */}
        <div style={{display:'flex',alignItems:'center',gap:9,padding:'13px 14px',borderBottom:'1px solid var(--glass-border)',flexShrink:0}}>
          <div style={{width:27,height:27,background:'linear-gradient(135deg,var(--accent),var(--accent2))',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'#fff',flexShrink:0}}>&#9889;</div>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14,whiteSpace:'nowrap'}}>Permitting Scope Map</div>
            {statusMsg&&<div style={{fontSize:10,color:'var(--warn)'}}>{statusMsg}</div>}
          </div>
        </div>
        {/* Company + Basemap */}
        <div style={Object.assign({},SEC,{flexShrink:0})}>
          <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Company</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:9}}>
            {manifest&&Object.entries(manifest.companies).map(function(e){var k=e[0],c=e[1];return <button key={k} onClick={function(){setCompany(k);}} style={PILL(company===k)}>{c.short}</button>;})}
          </div>
          <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Basemap</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
            {Object.entries(BASEMAPS).map(function(e){var k=e[0],bm=e[1];return <button key={k} onClick={function(){setBasemap(k);}} style={BMPILL(basemap===k)}>{bm.label}</button>;})}
          </div>
        </div>
        {/* Search */}
        <div style={Object.assign({},SEC,{flexShrink:0})}>
          <div style={{display:'flex',gap:5}}>
            <input value={searchText} onChange={function(e){setSearchText(e.target.value);setErr('');}} onKeyDown={function(e){if(e.key==='Enter')handleSearch();}} placeholder="Search address or place..." style={{flex:1,padding:'7px 10px',borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.05)',color:'var(--text)',fontSize:11,fontFamily:'var(--font)',outline:'none'}}/>
            <button onClick={handleSearch} style={{fontSize:11,padding:'7px 13px',borderRadius:8,background:'linear-gradient(135deg,var(--accent),var(--accent2))',color:'#fff',border:'none',fontWeight:700,cursor:'pointer',fontFamily:'var(--font)'}}>Go</button>
          </div>
          {err&&<div style={{color:'var(--danger)',fontSize:10,marginTop:3}}>{err}</div>}
        </div>
        {/* Tab bar */}
        <div style={{display:'flex',borderBottom:'1px solid var(--glass-border)',flexShrink:0}}>
          {[['layers','Layers'],['locations','Locations'],['results','Results']].map(function(t){var on=sideTab===t[0];
            return <button key={t[0]} onClick={function(){setSideTab(t[0]);}} style={{flex:1,padding:'9px 0',fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:'uppercase',fontFamily:'var(--font)',background:'transparent',border:'none',borderBottom:on?'2px solid var(--accent)':'2px solid transparent',color:on?'var(--text)':'var(--muted)',cursor:'pointer'}}>
              {t[1]}{t[0]==='locations'&&pts.length>0?' ('+pts.length+')':''}{t[0]==='results'&&totalPermits>0?' ('+totalPermits+')':''}
            </button>;})}
        </div>
        {/* ============ TAB BODY ============ */}
        <div style={{flex:1,overflowY:'auto',overflowX:'hidden'}}>
          {/* ---- LAYERS TAB ---- */}
          {sideTab==='layers'&&<div style={{padding:'12px 14px'}}>
            <div style={{fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'var(--accent)',fontWeight:700,display:'flex',alignItems:'center',gap:7,marginBottom:9}}><span style={{width:3,height:13,background:'var(--accent)',borderRadius:2,display:'inline-block'}}/>Layers{anyLoading?' \u2022 Loading...':''}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:12}}>
              {co&&Object.entries(co.layers).map(function(e){var lk=e[0],lcfg=e[1];var active=tg[lk];var clr=typeof lcfg.color==='object'?'#4a9eff':lcfg.color;
                return <button key={lk} onClick={function(){setLayerToggles(function(p){var n=Object.assign({},p);n[company]=Object.assign({},n[company]);n[company][lk]=!n[company][lk];return n;});}} style={{fontSize:10,padding:'3px 9px',borderRadius:20,border:'1px solid '+(active?clr+'66':'var(--glass-border)'),background:active?clr+'18':'rgba(255,255,255,0.03)',color:active?clr:'var(--muted)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                  <span style={{width:6,height:6,borderRadius:'50%',background:clr,opacity:active?1:0.3}}/>{lcfg.label}{loadingLayers[company+'_'+lk]?' ...':''}
                </button>;})}
            </div>
            {co&&Object.entries(co.layers).filter(function(e){return tg[e[0]];}).length>0&&<div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Opacity</div>}
            {co&&Object.entries(co.layers).filter(function(e){return tg[e[0]];}).map(function(e){var lk=e[0],lcfg=e[1];var clr=typeof lcfg.color==='object'?'#4a9eff':lcfg.color;
              return <div key={lk+'_op'} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4,fontSize:10}}>
                <span style={{color:clr,minWidth:70,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lcfg.label}</span>
                <input type="range" min="0" max="100" value={Math.round((op[lk]||1)*100)} onChange={function(ev){setLayerOpacity(function(p){var n=Object.assign({},p);n[company]=Object.assign({},n[company]);n[company][lk]=parseInt(ev.target.value)/100;return n;});}} style={{flex:1,height:3,accentColor:'var(--accent)'}}/>
                <span style={{color:'var(--muted)',fontFamily:'var(--mono)',fontSize:9,minWidth:26,textAlign:'right'}}>{Math.round((op[lk]||1)*100)}%</span>
              </div>;})}
            <button onClick={function(){setShowLegend(!showLegend);}} style={{fontSize:10,color:'var(--muted)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',marginTop:8,fontFamily:'var(--font)'}}>{showLegend?'Hide Legend':'Show Legend'}</button>
            {showLegend&&co&&<div style={{marginTop:7,padding:10,background:'rgba(255,255,255,0.04)',border:'1px solid var(--glass-border)',borderRadius:9,fontSize:11}}>
              {Object.entries(co.layers).map(function(e){var lk=e[0],lcfg=e[1];
                if(typeof lcfg.color==='object'){return <div key={lk} style={{marginBottom:3}}><div style={{fontWeight:600,marginBottom:1}}>{lcfg.label}:</div>{Object.entries(lcfg.color).map(function(ce){return <div key={ce[0]} style={{display:'flex',alignItems:'center',gap:5,marginLeft:6,marginBottom:1}}><span style={{width:14,height:2,background:ce[1],display:'inline-block'}}/><span style={{fontSize:10}}>{ce[0]==='I'?'Interstate':ce[0]==='U'?'US Hwy':ce[0]==='S'?'State':ce[0]==='M'?'Major':'Local'}</span></div>;})}</div>;}
                var clr=lcfg.color;return <div key={lk} style={{display:'flex',alignItems:'center',gap:5,marginBottom:2}}>{lcfg.type==='point'?<span style={{width:6,height:6,borderRadius:'50%',background:clr,display:'inline-block'}}/>:lcfg.type==='polygon'?<span style={{width:14,height:8,border:'1.5px solid '+clr,borderRadius:1,display:'inline-block'}}/>:<span style={{width:14,height:2,background:clr,display:'inline-block'}}/>}<span style={{fontSize:10}}>{lcfg.label}</span></div>;
              })}
            </div>}
          </div>}
          {/* ---- LOCATIONS TAB ---- */}
          {sideTab==='locations'&&<div>
            {selIds.length>0&&<div style={{padding:'7px 14px',background:'rgba(74,158,255,0.08)',borderBottom:'1px solid var(--glass-border)',display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:10,color:'#4a9eff',fontWeight:700}}>{selIds.length} sel:</span>
              {Object.entries(PIN_COLORS).map(function(e){var k=e[0],c=e[1];return <button key={k} onClick={function(){selIds.forEach(function(id){updatePoint(id,{color:k});});setSelIds([]);}} style={{fontSize:9,padding:'2px 7px',borderRadius:9,cursor:'pointer',fontFamily:'var(--font)',border:'1px solid '+c.bg+'55',background:c.bg+'22',color:c.bg,display:'flex',alignItems:'center',gap:3}}><span style={{width:5,height:5,borderRadius:'50%',background:c.bg}}/>{c.label}</button>;})}
              <button onClick={function(){selIds.forEach(function(id){removePoint(id);});setSelIds([]);}} style={{fontSize:9,padding:'2px 7px',borderRadius:9,cursor:'pointer',fontFamily:'var(--font)',border:'1px solid var(--danger)',background:'rgba(255,77,106,0.15)',color:'var(--danger)'}}>Delete</button>
              <button onClick={function(){setSelIds([]);}} style={{fontSize:9,padding:'2px 7px',borderRadius:9,cursor:'pointer',fontFamily:'var(--font)',border:'1px solid var(--glass-border)',background:'transparent',color:'var(--muted)'}}>Clear</button>
            </div>}
            {pts.length===0?<div style={{padding:'22px 14px',textAlign:'center',fontSize:11,color:'var(--muted)',lineHeight:1.7}}>Right-click the map to drop a pin,<br/>search an address, or import CSV / KML.</div>
            :pts.map(function(pt){var pc=PIN_COLORS[pt.color]||PIN_COLORS.review;var isSel=selId===pt.id;var isMulti=selIds.indexOf(pt.id)>=0;
              return <div key={pt.id} onClick={function(e){if(e.shiftKey){setSelIds(function(prev){return prev.indexOf(pt.id)>=0?prev.filter(function(x){return x!==pt.id;}):prev.concat([pt.id]);});}else{setSelId(pt.id);setSelIds([]);if(res[pt.id])setSideTab('results');}}} style={{padding:'7px 12px 7px 11px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',borderLeft:isSel?'3px solid var(--accent)':isMulti?'3px solid #4a9eff':'3px solid transparent',background:isSel?'rgba(255,255,255,.05)':isMulti?'rgba(74,158,255,.07)':'transparent',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                <div style={{display:'flex',alignItems:'center',gap:7,flex:1,minWidth:0}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:isMulti?'#4a9eff':pc.bg,flexShrink:0,boxShadow:'0 0 6px '+(isMulti?'#4a9eff':pc.bg)+'66'}}/>
                  <div style={{minWidth:0}}><div style={{fontSize:11,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pt.name}</div><div style={{fontSize:9,color:'var(--muted)',fontFamily:'var(--mono)'}}>{pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}</div></div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                  {res[pt.id]&&<div style={{width:6,height:6,borderRadius:'50%',background:'var(--success)'}}/>}
                  <button onClick={function(e){e.stopPropagation();removePoint(pt.id);}} style={{width:17,height:17,borderRadius:4,border:'none',background:'transparent',color:'var(--muted)',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center'}}>&#215;</button>
                </div>
              </div>;})}
            {pts.length>0&&<div style={{padding:'7px 14px',fontSize:9,color:'var(--muted)',lineHeight:1.6}}>Shift+click to multi-select &middot; select 2+ pins to measure between them</div>}
          </div>}
          {/* ---- RESULTS TAB ---- */}
          {sideTab==='results'&&<div>
            {sel&&sel.info&&selPt?<div>
              {/* Point navigator */}
              {(function(){var list=pts.filter(function(p){return res[p.id];});var idx=list.findIndex(function(p){return p.id===selPt.id;});var pc=(PIN_COLORS[selPt.color]||PIN_COLORS.review);var pmN=sel.pm?sel.pm.length:0;
              return <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid var(--glass-border)',position:'sticky',top:0,background:'var(--surface)',zIndex:5}}>
                <button onClick={function(){cyclePoint(-1);}} title="Previous point (\u2190)" style={NAVBTN}>&#8249;</button>
                <div style={{flex:1,minWidth:0,textAlign:'center'}}>
                  <div style={{fontSize:12,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',gap:6,overflow:'hidden'}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:pc.bg,flexShrink:0,boxShadow:'0 0 6px '+pc.bg+'66'}}/>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selPt.name}</span>
                  </div>
                  <div style={{fontSize:9,color:'var(--muted)',fontFamily:'var(--mono)',marginTop:1}}>{(idx+1)+' of '+list.length+' \u00b7 '+pmN+' permit'+(pmN===1?'':'s')}</div>
                </div>
                <button onClick={function(){cyclePoint(1);}} title="Next point (\u2192)" style={NAVBTN}>&#8250;</button>
              </div>;})()}
              <div style={{padding:'12px 14px'}}>

                  <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid var(--glass-border)',borderRadius:10,padding:12,marginBottom:10}}>
                    <input value={selPt.name} onChange={function(e){updatePoint(selPt.id,{name:e.target.value});}} style={{fontWeight:700,fontSize:14,marginBottom:8,background:'transparent',border:'none',borderBottom:'1px solid var(--glass-border)',color:'var(--text)',width:'100%',outline:'none',fontFamily:'var(--font)',padding:'2px 0'}}/>
                    {sel.info.address&&<div style={{fontSize:11,color:'var(--text)',opacity:0.85,marginBottom:8,padding:'6px 8px',background:'rgba(255,255,255,0.05)',borderRadius:6,lineHeight:1.4}}>
                      <span style={{color:'var(--muted)',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Address</span><br/>{sel.info.address}
                    </div>}
                    {[['Coords',selPt.lat.toFixed(5)+', '+selPt.lng.toFixed(5),'var(--text)'],['State',sel.info.state||'\u2014','var(--text)'],[sel.info.state==='Louisiana'?'Parish':'County',sel.info.county||'\u2014','#4a9eff'],['City',sel.info.city||'Unincorporated','var(--success)']].concat(sel.info.dot&&sel.info.dot.length&&sel.info.dot[0].district?[['FDOT District',sel.info.dot[0].district,'var(--warn)']]:[]).concat(sel.info.row?[['ROW',sel.info.row,'#f472b6']]:[]).concat(sel.info.elevation?[['Elev',sel.info.elevation.ft.toFixed(1)+' ft','#06b6d4']]:[])
                    .map(function(r,i){return <div key={i} style={{fontSize:11,padding:'3px 0',display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--muted)'}}>{r[0]}</span><span style={{fontWeight:600,fontFamily:'var(--mono)',color:r[2],fontSize:11}}>{r[1]}</span></div>;})}
                  </div>
                  {(sel.info.dot.length>0||sel.info.rr.length>0||sel.info.transmission.length>0||sel.info.levee.length>0||sel.info.faa.length>0)&&<>
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,margin:'10px 0 5px'}}>Summary</div>
                  <div style={{display:'flex',flexWrap:'wrap'}}>
                    {sel.info.dot.length>0&&<Badge label="DOT" value={sel.info.dot[0].n+' '+Math.round(sel.info.dot[0].d*3.28084)+'ft'} color="#4a9eff"/>}
                    {sel.info.rr.length>0&&<Badge label="RR" value={sel.info.rr[0].o+' '+Math.round(sel.info.rr[0].d*3.28084)+'ft'} color="var(--danger)"/>}
                    {sel.info.transmission.length>0&&<Badge label="Tx" value={Math.round(sel.info.transmission[0].d*3.28084)+'ft'} color="#a855f7"/>}
                    {sel.info.levee.length>0&&<Badge label="Levee" value={Math.round(sel.info.levee[0].d*3.28084)+'ft'} color="var(--warn)"/>}
                    {sel.info.faa.length>0&&<Badge label="FAA" value={(sel.info.faa[0].dist/1609.34).toFixed(1)+'mi'} color="#06b6d4"/>}
                  </div>
                  </>}
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,margin:'10px 0 5px'}}>{'Permits ('+(sel.pm?sel.pm.length:0)+')'}</div>
                  {sel.pm&&sel.pm.length>0?sel.pm.map(function(p,i){return <PermitCard key={i} p={p}/>;}):
                  <div style={{fontSize:12,color:'var(--muted)',textAlign:'center',padding:14}}>No permits flagged</div>}
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,margin:'10px 0 5px'}}>Nearby Features</div>
                  <DetailBox title={sel.info.dot.length?'DOT Roads ('+sel.info.dot.length+')':'DOT Roads \u2014 Clear'} color="#4a9eff">{sel.info.dot.map(function(h,i){return <NearbyRow key={i} label={h.n+' ('+h.t+')'+(h.mp?' \u00b7 MP '+h.mp:'')+(h.w?' \u00b7 ~EOP '+Math.max(0,Math.round(h.d*3.28084-h.w/2))+'ft':'')} dist={h.d} dir={h.dir}/>;})}{!sel.info.dot.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 1,640ft</div>}</DetailBox>
                  <DetailBox title={sel.info.rr.length?'Railroads ('+sel.info.rr.length+')':'Railroads \u2014 Clear'} color="var(--danger)">{sel.info.rr.map(function(r,i){return <NearbyRow key={i} label={r.o} dist={r.d} dir={r.dir}/>;})}{!sel.info.rr.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 2,625ft</div>}</DetailBox>
                  {sel.info.rrx&&sel.info.rrx.length>0&&<DetailBox title={'RR Crossings ('+sel.info.rrx.length+')'} color="#fb7185">{sel.info.rrx.map(function(x,i){return <NearbyRow key={i} label={x.n} dist={x.dist} dir={x.brg}/>;})}</DetailBox>}
                  <DetailBox title={sel.info.transmission.length?'Transmission ('+sel.info.transmission.length+')':'Transmission \u2014 Clear'} color="#a855f7">{sel.info.transmission.map(function(t,i){return <NearbyRow key={i} label={(t.n||'Line')+(t.v?' ('+t.v+')':'')} dist={t.d} dir={t.dir}/>;})}{!sel.info.transmission.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 2,625ft</div>}</DetailBox>
                  <DetailBox title={sel.info.levee.length?'Levees ('+sel.info.levee.length+')':'Levees \u2014 Clear'} color="var(--warn)">{sel.info.levee.map(function(l,i){return <NearbyRow key={i} label={l.n+(l.s?' ['+l.s+']':'')} dist={l.d} dir={l.dir}/>;})}{!sel.info.levee.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 2,625ft</div>}</DetailBox>
                  <DetailBox title={sel.info.faa.length?'Airports ('+sel.info.faa.length+')':'Airports \u2014 Clear'} color="#06b6d4">{sel.info.faa.map(function(a,i){return <NearbyRow key={i} label={a.n} dist={a.dist} dir={a.brg}/>;})}{!sel.info.faa.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 10,000ft</div>}</DetailBox>
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Status</div>
                  <div style={{display:'flex',gap:3,marginBottom:10,flexWrap:'wrap'}}>
                    {Object.entries(PIN_COLORS).map(function(e){var k=e[0],c=e[1];var isS=selPt.color===k;return <button key={k} onClick={function(){updatePoint(selPt.id,{color:k});}} style={{fontSize:10,padding:'3px 9px',borderRadius:11,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,display:'flex',alignItems:'center',gap:3,border:isS?'2px solid '+c.bg:'1px solid var(--glass-border)',background:isS?c.bg+'44':'transparent',color:isS?'#fff':'var(--muted)'}}><span style={{width:6,height:6,borderRadius:'50%',background:c.bg}}/>{c.label}</button>;})}
                  </div>
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Notes</div>
                  <textarea value={selPt.notes||''} onChange={function(e){updatePoint(selPt.id,{notes:e.target.value});}} placeholder="Add notes..." style={{width:'100%',minHeight:50,padding:9,borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.05)',color:'var(--text)',fontSize:11,fontFamily:'var(--font)',outline:'none',resize:'vertical'}}/>
              </div>
            </div>
            :pts.length>0&&Object.keys(res).length>0?<div style={{color:'var(--muted)',fontSize:11,textAlign:'center',padding:20}}>Select a location to see its results</div>
            :pts.length>0?<div style={{color:'var(--muted)',fontSize:11,textAlign:'center',padding:20}}>Click <b style={{color:'var(--text)'}}>Analyze</b> to check your locations</div>
            :<div style={{color:'var(--muted)',fontSize:11,textAlign:'center',padding:20}}>Add locations first</div>}
          </div>}
        </div>
        {/* ============ FOOTER ============ */}
        <div style={{borderTop:'1px solid var(--glass-border)',padding:'8px 12px',flexShrink:0}} onDragOver={function(e){e.preventDefault();}} onDrop={function(e){e.preventDefault();var f=e.dataTransfer.files[0];if(f){var n=f.name.toLowerCase();if(n.endsWith('.csv'))handleCSV(f);else if(n.endsWith('.kml')||n.endsWith('.kmz'))handleKMLFile(f);}}}>
          {shareV2&&<div style={{marginBottom:8}}>
            <div style={PLABEL}>Project</div>
            {proj?<div style={{border:'1px solid rgba(232,67,79,0.35)',background:'linear-gradient(135deg,rgba(232,67,79,0.10),rgba(240,101,67,0.05))',borderRadius:10,padding:'7px 9px'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:7,height:7,borderRadius:'50%',flexShrink:0,background:projUpdate?'#e6a23c':'var(--success)',boxShadow:'0 0 6px '+(projUpdate?'#e6a23c':'var(--success)')}}/>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:12,fontWeight:800,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{proj.id}</div>
                  <div style={{fontSize:9,color:projDirty?'#e6a23c':'var(--muted)',marginTop:1}}>{projDirty?'Unsaved changes':((proj.by?proj.by+' saved ':'Saved ')+timeAgo(proj.savedAt))}{proj.secondsLeft?' \u00b7 expires in '+Math.max(1,Math.round(proj.secondsLeft/86400))+'d':''}</div>
                </div>
                <button disabled={projBusy} onClick={function(){projSave(false);}} style={Object.assign({},ACCENTBTN,projBusy?{background:'rgba(255,255,255,0.1)',cursor:'default'}:{})}>{projBusy?'\u2026':'Save'}</button>
                <div style={{position:'relative'}}>
                  <button onClick={function(){setProjMenu(!projMenu);}} style={Object.assign({},FBTN,{padding:'5px 8px',fontWeight:800})}>&#8942;</button>
                  {projMenu&&<div style={{position:'absolute',bottom:'110%',right:0,background:'var(--surface)',border:'1px solid var(--glass-border)',borderRadius:9,padding:4,zIndex:2500,boxShadow:'0 10px 30px rgba(0,0,0,0.5)',minWidth:140}}>
                    <button onClick={function(){setProjMenu(false);navigator.clipboard.writeText(window.location.origin+'/?p='+encodeURIComponent(proj.id)).then(function(){setStatusMsg('Project link copied');setTimeout(function(){setStatusMsg('');},2500);}).catch(function(){});}} style={PMENU}>Copy project link</button>
                    <button onClick={function(){setProjMenu(false);setProjErr('');setProjModal(true);}} style={PMENU}>Switch project</button>
                    <button onClick={function(){setProjMenu(false);projLeave();}} style={PMENU}>Leave project</button>
                  </div>}
                </div>
              </div>
              {projUpdate&&!projUpdateMin&&<div style={{display:'flex',alignItems:'center',gap:6,marginTop:7,paddingTop:7,borderTop:'1px solid rgba(255,255,255,0.08)'}}>
                <div style={{fontSize:9.5,color:'#e6a23c',flex:1}}>{(projUpdate.by||'Teammate')+' saved '+timeAgo(projUpdate.savedAt)}</div>
                <button onClick={projLoadLatest} style={Object.assign({},FBTN,{color:'#0b0d11',background:'#e6a23c',border:'1px solid transparent',fontWeight:700})}>Load</button>
                <button onClick={function(){setProjUpdateMin(true);}} style={Object.assign({},FBTN,{padding:'5px 8px'})}>&#10005;</button>
              </div>}
              {projUpdate&&projUpdateMin&&<div onClick={function(){setProjUpdateMin(false);}} style={{fontSize:9,color:'#e6a23c',marginTop:5,cursor:'pointer'}}>Update available \u2014 tap to view</div>}
            </div>
            :<div style={{border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.03)',borderRadius:10,padding:'7px 9px',display:'flex',alignItems:'center',gap:8}}>
              <div style={{fontSize:11,fontWeight:600,color:'var(--muted)',flex:1}}>No project</div>
              <button onClick={function(){setProjErr('');setProjModal(true);}} style={ACCENTBTN}>Open / Start</button>
            </div>}
          </div>}
          <div style={{display:'flex',gap:4,marginBottom:6}}>
            <button onClick={function(){setPinMode(!pinMode);setMeasureMode(false);setAreaMode(false);}} style={Object.assign({},FBTN,{flex:1},pinMode?{background:'linear-gradient(135deg,var(--accent),var(--accent2))',color:'#fff',border:'1px solid transparent'}:{})}>+ Pin</button>
            <button onClick={function(){setMeasureMode(!measureMode);setPinMode(false);setAreaMode(false);if(measureMode)setMeasurePts([]);}} style={Object.assign({},FBTN,{flex:1},measureMode?{background:'#4a9eff',color:'#fff',border:'1px solid transparent'}:{})}>Measure</button>
            <button onClick={function(){setAreaMode(!areaMode);setPinMode(false);setMeasureMode(false);if(areaMode)setAreaPts([]);}} style={Object.assign({},FBTN,{flex:1},areaMode?{background:'#a855f7',color:'#fff',border:'1px solid transparent'}:{})}>Area</button>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button onClick={function(){importRef.current&&importRef.current.click();}} style={Object.assign({},FBTN,{flex:1})}>Import</button>
            <input ref={importRef} type="file" accept=".csv,.kml,.kmz,.json" style={{display:'none'}} onChange={function(e){var f=e.target.files[0];if(!f)return;var n=f.name.toLowerCase();if(n.endsWith('.csv'))handleCSV(f);else if(n.endsWith('.kml')||n.endsWith('.kmz'))handleKMLFile(f);else if(n.endsWith('.json'))loadProject(f);e.target.value='';}}/>
            <div style={{position:'relative',flex:1,display:'flex'}}>
              <button onClick={function(){setExportMenu(!exportMenu);}} style={Object.assign({},FBTN,{flex:1})}>Export &#9662;</button>
              {exportMenu&&<div style={{position:'absolute',bottom:'110%',left:0,right:0,background:'var(--surface)',border:'1px solid var(--glass-border)',borderRadius:9,padding:4,zIndex:2500,boxShadow:'0 10px 30px rgba(0,0,0,0.5)'}}>
                <button onClick={function(){setExportMenu(false);exportCSV();}} style={PMENU}>CSV</button>
                <button onClick={function(){setExportMenu(false);exportKML();}} style={PMENU}>KML</button>
                <button onClick={function(){setExportMenu(false);saveProject();}} style={PMENU}>Project file</button>
              </div>}
            </div>
            <button onClick={function(){if(!pts.length)return;shareV2?(setShareErr(''),setShareOpen(true)):getShareLink();}} style={Object.assign({},FBTN,{flex:1},pts.length?{color:'#fff',background:'linear-gradient(135deg,var(--accent),var(--accent2))',border:'1px solid transparent',fontWeight:700}:{opacity:0.45,cursor:'default'})}>Share</button>
          </div>
        </div>
      </div>
      {/* Resize handle */}
      <div onMouseDown={function(e){startResize('left',e);}} style={{width:5,cursor:'col-resize',background:'transparent',flexShrink:0,position:'relative',zIndex:10}}><div style={{position:'absolute',top:'50%',left:1,width:3,height:44,marginTop:-22,background:'var(--glass-border)',borderRadius:2}}/></div>
      {/* ================= MAP ================= */}
      <div style={{flex:1,position:'relative',overflow:'hidden'}}>
        <div ref={mapRef} style={{width:'100%',height:'100%',cursor:measureMode?'crosshair':areaMode?'crosshair':pinMode?'crosshair':'grab'}}/>
        {pinMode&&<div style={{position:'absolute',top:12,left:12,zIndex:1000,background:'rgba(18,18,26,0.85)',backdropFilter:'blur(20px)',border:'1px solid var(--glass-border)',borderRadius:10,padding:'8px 14px',fontSize:12,color:'var(--text)',display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--accent)',animation:'pulse 1.5s infinite'}}/> Click to drop pin &mdash; Esc to cancel</div>}
        {measureMode&&<div style={{position:'absolute',top:12,left:12,zIndex:1000,background:'rgba(74,158,255,0.92)',borderRadius:10,padding:'8px 14px',fontSize:12,color:'#fff',display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#fff',animation:'pulse 1.5s infinite'}}/> Click map or pins to measure &mdash; Esc to stop ({measurePts.length} pts)</div>}
        {areaMode&&<div style={{position:'absolute',top:12,left:12,zIndex:1000,background:'rgba(168,85,247,0.92)',borderRadius:10,padding:'8px 14px',fontSize:12,color:'#fff',display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#fff',animation:'pulse 1.5s infinite'}}/> Click to draw area &mdash; Esc to stop ({areaPts.length} pts)</div>}
        {multiWarn&&<div style={{position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',zIndex:1001,background:'rgba(18,18,26,0.92)',backdropFilter:'blur(20px)',border:'1px solid var(--warn)',borderRadius:11,padding:'8px 13px',display:'flex',alignItems:'center',gap:7,flexWrap:'wrap',maxWidth:'85%'}}>
          <span style={{fontSize:11,color:'var(--warn)',fontWeight:700}}>&#9888; Pins span {multiWarn.list.length} territories</span>
          <span style={{fontSize:10,color:'var(--muted)'}}>&mdash; analysis handles each pin automatically; pick which layers to view:</span>
          {multiWarn.list.map(function(k){return <button key={k} onClick={function(){setCompany(k);}} style={{fontSize:10,padding:'3px 9px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:700,border:company===k?'1px solid var(--warn)':'1px solid var(--glass-border)',background:company===k?'rgba(230,162,60,0.15)':'rgba(255,255,255,0.05)',color:company===k?'var(--warn)':'var(--text)'}}>{manifest.companies[k].short} ({multiWarn.counts[k]})</button>;})}
          <button onClick={function(){multiDismissRef.current=multiWarn.list.slice().sort().join(',');setMultiWarn(null);}} style={{fontSize:13,background:'none',border:'none',color:'var(--muted)',cursor:'pointer',padding:'0 2px'}}>&#215;</button>
        </div>}
        {pts.length>0&&<div style={{position:'absolute',bottom:18,left:'50%',transform:'translateX(-50%)',display:'flex',gap:8,zIndex:1000,width:'min(420px,70%)'}}>
          <button style={{flex:1,padding:'11px 0',background:busy?'rgba(18,18,26,0.85)':'linear-gradient(135deg,var(--accent),var(--accent2))',color:busy?'var(--muted)':'#fff',border:busy?'1px solid var(--glass-border)':'none',borderRadius:11,fontSize:13,fontWeight:700,fontFamily:'var(--font)',cursor:busy?'default':'pointer',boxShadow:busy?'none':'0 6px 24px rgba(232,67,79,.35)',backdropFilter:'blur(20px)'}} disabled={busy} onClick={analyzeAll}>{busy?statusMsg||'Analyzing...':'Analyze '+pts.length+' Location'+(pts.length>1?'s':'')}</button>
          <button style={{padding:'11px 15px',background:'rgba(18,18,26,0.85)',backdropFilter:'blur(20px)',color:'var(--muted)',border:'1px solid var(--glass-border)',borderRadius:11,fontSize:11,fontFamily:'var(--font)',cursor:'pointer'}} onClick={function(){setPts([]);setRes({});setSelId(null);setSelIds([]);nextId.current=1;try{localStorage.removeItem('psm_session');}catch(e){}}}>Clear</button>
        </div>}
        <div style={{position:'absolute',bottom:18,right:14,zIndex:1000,background:'rgba(18,18,26,0.85)',backdropFilter:'blur(20px)',border:'1px solid var(--glass-border)',borderRadius:10,padding:'6px 12px',fontFamily:'var(--mono)',fontSize:10,color:'var(--muted)',display:'flex',gap:12}}>
          <span>{cursorCoords?cursorCoords.lat+', '+cursorCoords.lng:'\u2014'}</span>
          <span>z{Math.round(zoomLevel*10)/10}</span>
          {co&&<span>{co.short}</span>}
          <span>{pts.length} pts{totalPermits>0?' \u00b7 '+totalPermits+' permits':''}</span>
        </div>
      </div>
      {/* ---- Share v2 dialog (floating; renders only when open) ---- */}
      {shareOpen&&<div onClick={function(){if(!shareBusy)setShareOpen(false);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div onClick={function(e){e.stopPropagation();}} style={{width:320,maxWidth:'92vw',background:'var(--surface)',border:'1px solid var(--glass-border)',borderRadius:14,padding:18,boxShadow:'0 18px 60px rgba(0,0,0,0.55)'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>Share {pts.length} point{pts.length>1?'s':''}</div>
          <div style={{fontSize:10,color:'var(--muted)',marginBottom:12}}>Creates an expiring link. Only people with the link (or project #) can see it.</div>
          <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Shelf life</div>
          <div style={{display:'flex',gap:5,marginBottom:12}}>
            {[7,30,90].map(function(d){var on=shareTtl===d;return <button key={d} onClick={function(){setShareTtl(d);}} style={{flex:1,fontSize:11,padding:'7px 0',borderRadius:8,cursor:'pointer',fontFamily:'var(--font)',fontWeight:700,border:'1px solid '+(on?'transparent':'var(--glass-border)'),background:on?'linear-gradient(135deg,var(--accent),var(--accent2))':'rgba(255,255,255,0.04)',color:on?'#fff':'var(--muted)'}}>{d} days</button>;})}
          </div>
          <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Your name <span style={{textTransform:'none',letterSpacing:0,fontWeight:500}}>(optional)</span></div>
          <input value={shareBy} onChange={function(e){setShareBy(e.target.value);}} placeholder="Shown to whoever opens it" style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.05)',color:'var(--text)',fontSize:11,fontFamily:'var(--font)',outline:'none',marginBottom:12}}/>
          {shareErr&&<div style={{color:'var(--danger)',fontSize:10,marginBottom:8}}>{shareErr}</div>}
          <div style={{display:'flex',gap:6}}>
            <button disabled={shareBusy} onClick={createShareV2} style={{flex:1,padding:'9px 0',borderRadius:9,border:'none',cursor:shareBusy?'default':'pointer',fontFamily:'var(--font)',fontWeight:700,fontSize:12,color:'#fff',background:shareBusy?'rgba(255,255,255,0.1)':'linear-gradient(135deg,var(--accent),var(--accent2))'}}>{shareBusy?'Creating\u2026':'Create link'}</button>
            <button disabled={shareBusy} onClick={function(){setShareOpen(false);}} style={{padding:'9px 14px',borderRadius:9,border:'1px solid var(--glass-border)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,fontSize:12,color:'var(--muted)',background:'transparent'}}>Cancel</button>
          </div>
        </div>
      </div>}
      {/* ---- Open / start project dialog ---- */}
      {projModal&&<div onClick={function(){if(!projBusy)setProjModal(false);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div onClick={function(e){e.stopPropagation();}} style={{width:320,maxWidth:'92vw',background:'var(--surface)',border:'1px solid var(--glass-border)',borderRadius:14,padding:18,boxShadow:'0 18px 60px rgba(0,0,0,0.55)'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>Open or start a project</div>
          <div style={{fontSize:10,color:'var(--muted)',marginBottom:12}}>Opens it if it exists \u2014 otherwise creates it with your current {pts.length} point{pts.length===1?'':'s'}. Projects expire 180 days after their last save.</div>
          <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Project #</div>
          <input value={projInput} onChange={function(e){setProjInput(e.target.value);}} onKeyDown={function(e){if(e.key==='Enter')projOpenStart();}} placeholder="e.g. WR-4512087" style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.05)',color:'var(--text)',fontSize:11,fontFamily:'var(--font)',outline:'none',marginBottom:12}}/>
          <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Your name <span style={{textTransform:'none',letterSpacing:0,fontWeight:500}}>(shown on saves)</span></div>
          <input value={projName} onChange={function(e){setProjName(e.target.value);}} placeholder="e.g. Olivier" style={{width:'100%',boxSizing:'border-box',padding:'7px 10px',borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.05)',color:'var(--text)',fontSize:11,fontFamily:'var(--font)',outline:'none',marginBottom:12}}/>
          {projErr&&<div style={{color:'var(--danger)',fontSize:10,marginBottom:8}}>{projErr}</div>}
          <div style={{display:'flex',gap:6}}>
            <button disabled={projBusy} onClick={projOpenStart} style={{flex:1,padding:'9px 0',borderRadius:9,border:'none',cursor:projBusy?'default':'pointer',fontFamily:'var(--font)',fontWeight:700,fontSize:12,color:'#fff',background:projBusy?'rgba(255,255,255,0.1)':'linear-gradient(135deg,var(--accent),var(--accent2))'}}>{projBusy?'Working\u2026':'Open / Start'}</button>
            <button disabled={projBusy} onClick={function(){setProjModal(false);}} style={{padding:'9px 14px',borderRadius:9,border:'1px solid var(--glass-border)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,fontSize:12,color:'var(--muted)',background:'transparent'}}>Cancel</button>
          </div>
        </div>
      </div>}
      {/* ---- Save conflict dialog: last save wins, never silently ---- */}
      {projConflict&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:3100,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{width:320,maxWidth:'92vw',background:'var(--surface)',border:'1px solid var(--glass-border)',borderRadius:14,padding:18,boxShadow:'0 18px 60px rgba(0,0,0,0.55)'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>Someone saved first</div>
          <div style={{fontSize:10.5,color:'var(--muted)',marginBottom:14,lineHeight:1.5}}>{(projConflict.by||'A teammate')+' saved '+timeAgo(projConflict.savedAt)+'. Load their version (your unsaved edits are lost) or overwrite it with yours.'}</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={function(){setProjConflict(null);projLoadLatest();}} style={{flex:1,padding:'9px 0',borderRadius:9,border:'1px solid var(--glass-border)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:700,fontSize:11,color:'var(--text)',background:'rgba(255,255,255,0.06)'}}>Load theirs</button>
            <button onClick={function(){projSave(true);}} style={{flex:1,padding:'9px 0',borderRadius:9,border:'none',cursor:'pointer',fontFamily:'var(--font)',fontWeight:700,fontSize:11,color:'#fff',background:'linear-gradient(135deg,var(--accent),var(--accent2))'}}>Overwrite</button>
            <button onClick={function(){setProjConflict(null);}} style={{padding:'9px 12px',borderRadius:9,border:'1px solid var(--glass-border)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,fontSize:11,color:'var(--muted)',background:'transparent'}}>Cancel</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
