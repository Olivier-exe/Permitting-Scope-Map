'use client';
import {useState,useRef,useEffect,useCallback} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {runFullAnalysis,generatePermits,getElevation,reverseGeocode,haversine,bearing,polygonArea,polygonAreaMultiUnit,parseKML} from '../lib/spatial';

var PIN_COLORS = {
  review: {bg:'#e6a23c',label:'Needs Review'},
  approved: {bg:'#00d4aa',label:'Approved'},
  complete: {bg:'#4a9eff',label:'Complete'},
  issue: {bg:'#ff4d6a',label:'Issue'},
};

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
  var [tab,setTab]=useState('info');
  var [pinMode,setPinMode]=useState(false);
  var [measureMode,setMeasureMode]=useState(false);
  var [measurePts,setMeasurePts]=useState([]);
  var [areaMode,setAreaMode]=useState(false);
  var [areaPts,setAreaPts]=useState([]);
  var [basemap,setBasemap]=useState('dark');
  var [err,setErr]=useState('');
  var [cursorCoords,setCursorCoords]=useState(null);
  var [zoomLevel,setZoomLevel]=useState(7);
  var [searchText,setSearchText]=useState('');
  var [showLegend,setShowLegend]=useState(false);
  var [leftWidth,setLeftWidth]=useState(340);
  var [rightWidth,setRightWidth]=useState(380);
  var [sideTab,setSideTab]=useState('locations');
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

  // Auto-save session
  useEffect(function(){
    if(!pts.length&&!Object.keys(res).length)return;
    var timeout=setTimeout(function(){
      try{localStorage.setItem('psm_session',JSON.stringify({pts:pts,res:res,company:company,selId:selId}));}catch(e){}
    },1000);
    return function(){clearTimeout(timeout);};
  },[pts,res,company,selId]);

  // Restore session on mount
  useEffect(function(){
    try{var s=localStorage.getItem('psm_session');if(s){var d=JSON.parse(s);if(d.pts&&d.pts.length){setPts(d.pts);var maxId=0;d.pts.forEach(function(p){if(p.id>maxId)maxId=p.id;});nextId.current=maxId+1;}if(d.res)setRes(d.res);if(d.company)setCompany(d.company);if(d.selId)setSelId(d.selId);}}catch(e){}
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
      var mk=L.marker(mid,{icon:L.divIcon({className:'',html:'<div style="background:rgba(0,0,0,0.9);color:#fff;padding:6px 12px;border-radius:6px;font-size:13px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(255,255,255,0.25);box-shadow:0 2px 8px rgba(0,0,0,0.5)">'+distStr+' | '+brng.toFixed(1)+'\u00b0</div>',iconAnchor:[70,-20]})}).addTo(m);
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
      var html='<div style="background:rgba(0,0,0,0.9);color:#a855f7;padding:6px 10px;border-radius:6px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(168,85,247,0.4);line-height:1.6">'+line1+'<br><span style="color:#c4b5fd;font-size:11px">'+line2+'</span>'+(line3?'<br><span style="color:#c4b5fd;font-size:11px">'+line3+'</span>':'')+'</div>';
      var mk=L.marker(center,{icon:L.divIcon({className:'',html:html,iconAnchor:[60,14]})}).addTo(m);
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
    });
    if(selIds.length>=2){
      var selPts=selIds.map(function(id){return pts.find(function(p){return p.id===id;});}).filter(Boolean);
      for(var i=0;i<selPts.length-1;i++){var a=selPts[i],b=selPts[i+1];var dist=haversine(a.lat,a.lng,b.lat,b.lng);var distFt=Math.round(dist*3.28084);var distStr=distFt>5280?((distFt/5280).toFixed(2)+' mi'):(distFt+' ft');var brg=bearing(a.lat,a.lng,b.lat,b.lng);
        var line=L.polyline([[a.lat,a.lng],[b.lat,b.lng]],{color:'#4a9eff',weight:2,dashArray:'6 4',opacity:0.9}).addTo(m);
        var label=L.marker([(a.lat+b.lat)/2,(a.lng+b.lng)/2],{icon:L.divIcon({className:'',html:'<div style="background:rgba(0,0,0,0.9);color:#4a9eff;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(74,158,255,0.3)">'+distStr+' | '+brg.toFixed(1)+'\u00b0</div>',iconAnchor:[60,-10]}),interactive:false}).addTo(m);
        pinMeasureLinesRef.current.push(line);pinMeasureLinesRef.current.push(label);
      }
      if(selPts.length>=3){var td=0;for(var j=0;j<selPts.length-1;j++){td+=haversine(selPts[j].lat,selPts[j].lng,selPts[j+1].lat,selPts[j+1].lng);}var tf=Math.round(td*3.28084);var ts=tf>5280?((tf/5280).toFixed(2)+' mi'):(tf+' ft');var lp=selPts[selPts.length-1];
        var tl=L.marker([lp.lat,lp.lng],{icon:L.divIcon({className:'',html:'<div style="background:rgba(0,0,0,0.9);color:#fff;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:700;border:1px solid rgba(255,255,255,0.2)">Total: '+ts+'</div>',iconAnchor:[50,20]}),interactive:false}).addTo(m);pinMeasureLinesRef.current.push(tl);}
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

  var detectCompany=useCallback(function(lat,lng){if(!manifest)return company;var regions={entergy_la:{minLat:28.5,maxLat:33.2,minLng:-94.1,maxLng:-88.7},entergy_tx:{minLat:29.0,maxLat:31.5,minLng:-96.0,maxLng:-93.5},exel_nm:{minLat:31.3,maxLat:37.0,minLng:-109.1,maxLng:-103.0},exel_tx:{minLat:25.8,maxLat:36.5,minLng:-106.7,maxLng:-93.5},colorado:{minLat:36.9,maxLat:41.1,minLng:-109.1,maxLng:-102.0},florida:{minLat:24.5,maxLat:31.0,minLng:-87.6,maxLng:-80.0}};var order=['florida','colorado','entergy_la','entergy_tx','exel_nm','exel_tx'];for(var i=0;i<order.length;i++){var k=order[i],b=regions[k];if(manifest.companies[k]&&lat>=b.minLat&&lat<=b.maxLat&&lng>=b.minLng&&lng<=b.maxLng)return k;}return company;},[manifest,company]);

  var analyzeAll=useCallback(async function(){
    if(!pts.length||!company||!manifest)return;setBusy(true);var newRes={};
    setStatusMsg('Loading layers...');
    var needed={};for(var i=0;i<pts.length;i++){var pc=detectCompany(pts[i].lat,pts[i].lng);var co=manifest.companies[pc];if(co){['dot','rr','transmission','levee','faa','cities','parishes','counties','row','parish_roads','orange_roads','osceola_roads','blm','usfs','nps','usfws','dod','usbr'].forEach(function(lk){var dk=pc+'_'+lk;if(co.layers[lk]&&!layerData[dk]&&!needed[dk])needed[dk]={file:co.layers[lk].file};});}}
    var nk=Object.keys(needed);if(nk.length){var lr=await Promise.all(nk.map(function(dk){return fetch('/layers/'+needed[dk].file).then(function(r){return r.json();}).then(function(d){return{dk:dk,data:d};}).catch(function(){return null;});}));lr.forEach(function(r){if(r)setLayerData(function(p){var n=Object.assign({},p);n[r.dk]=r.data;return n;});});}
    setStatusMsg('Spatial analysis...');
    var local=[];for(var i=0;i<pts.length;i++){var pt=pts[i];var pc=detectCompany(pt.lat,pt.lng);var r=runFullAnalysis(pt.lat,pt.lng,layerData,pc,manifest);if(r)r.detectedCompany=pc;local.push({pt:pt,info:r});}
    setStatusMsg('Fetching elevation & addresses...');
    var final=await Promise.all(local.map(function(lr){if(!lr.info)return Promise.resolve(lr);return Promise.all([getElevation(lr.pt.lat,lr.pt.lng),reverseGeocode(lr.pt.lat,lr.pt.lng)]).then(function(r){if(r[0])lr.info.elevation=r[0];if(r[1])lr.info.address=r[1];return lr;});}));
    final.forEach(function(lr){newRes[lr.pt.id]={info:lr.info,pm:lr.info?generatePermits(lr.info):[]};});
    setRes(Object.assign({},newRes));setBusy(false);setStatusMsg('');if(pts.length&&!selId)setSelId(pts[0].id);
  },[pts,company,manifest,layerData,selId,detectCompany]);

  var getShareLink=useCallback(function(){if(!pts.length)return;var params=pts.map(function(p){return p.lat.toFixed(5)+','+p.lng.toFixed(5)+','+encodeURIComponent(p.name);}).join('|');navigator.clipboard.writeText(window.location.origin+'?pins='+params+'&co='+(company||'')).then(function(){setStatusMsg('Link copied!');setTimeout(function(){setStatusMsg('');},2000);});},[pts,company]);

  useEffect(function(){var params=new URLSearchParams(window.location.search);var pinStr=params.get('pins');var coStr=params.get('co');if(pinStr){setPts(pinStr.split('|').map(function(p){var parts=p.split(',');return{id:nextId.current++,lat:parseFloat(parts[0]),lng:parseFloat(parts[1]),name:decodeURIComponent(parts[2]||'Pin'),color:'review',notes:''};}));}if(coStr&&manifest)setCompany(coStr);},[manifest]);

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
     - NO top bar. NO bottom status bar.
     - Map fills remaining space. Floating: mode hints (top-left),
       analyze pill (bottom-center), status chip (bottom-right).
     ============================================================ */
  var SEC={padding:'10px 14px',borderBottom:'1px solid var(--glass-border)'};
  var PILL=function(on){return{fontSize:10,padding:'4px 10px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid '+(on?'transparent':'var(--glass-border)'),background:on?'linear-gradient(135deg,var(--accent),var(--accent2))':'rgba(255,255,255,0.04)',color:on?'#fff':'var(--muted)'};};
  var BMPILL=function(on){return{fontSize:10,padding:'4px 9px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid '+(on?'var(--accent)':'var(--glass-border)'),background:on?'rgba(232,67,79,0.12)':'rgba(255,255,255,0.04)',color:on?'var(--accent)':'var(--muted)'};};
  var FBTN={fontSize:10,padding:'5px 10px',borderRadius:7,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.04)',color:'var(--muted)'};

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
              <div style={{display:'flex',borderBottom:'1px solid var(--glass-border)'}}>
                {['info','nearby','permits'].map(function(t){return <button key={t} onClick={function(){setTab(t);}} style={{flex:1,padding:'8px 0',fontSize:10,fontWeight:700,fontFamily:'var(--font)',textTransform:'uppercase',letterSpacing:0.5,background:'transparent',border:'none',borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent',color:tab===t?'var(--text)':'var(--muted)',cursor:'pointer'}}>{t==='info'?'Location':t==='nearby'?'Nearby':'Permits'}</button>;})}
              </div>
              <div style={{padding:'12px 14px'}}>
                {tab==='info'?<>
                  <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid var(--glass-border)',borderRadius:10,padding:12,marginBottom:10}}>
                    <input value={selPt.name} onChange={function(e){updatePoint(selPt.id,{name:e.target.value});}} style={{fontWeight:700,fontSize:14,marginBottom:8,background:'transparent',border:'none',borderBottom:'1px solid var(--glass-border)',color:'var(--text)',width:'100%',outline:'none',fontFamily:'var(--font)',padding:'2px 0'}}/>
                    {sel.info.address&&<div style={{fontSize:11,color:'var(--text)',opacity:0.85,marginBottom:8,padding:'6px 8px',background:'rgba(255,255,255,0.05)',borderRadius:6,lineHeight:1.4}}>
                      <span style={{color:'var(--muted)',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>Address</span><br/>{sel.info.address}
                    </div>}
                    {[['Coords',selPt.lat.toFixed(5)+', '+selPt.lng.toFixed(5),'var(--text)'],['State',sel.info.state||'\u2014','var(--text)'],[sel.info.state==='Louisiana'?'Parish':'County',sel.info.county||'\u2014','#4a9eff'],['City',sel.info.city||'Unincorporated','var(--success)']].concat(sel.info.dot&&sel.info.dot.length&&sel.info.dot[0].district?[['FDOT District',sel.info.dot[0].district,'var(--warn)']]:[]).concat(sel.info.row?[['ROW',sel.info.row,'#f472b6']]:[]).concat(sel.info.elevation?[['Elev',sel.info.elevation.ft.toFixed(1)+' ft','#06b6d4']]:[])
                    .map(function(r,i){return <div key={i} style={{fontSize:11,padding:'3px 0',display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--muted)'}}>{r[0]}</span><span style={{fontWeight:600,fontFamily:'var(--mono)',color:r[2],fontSize:11}}>{r[1]}</span></div>;})}
                  </div>
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Status</div>
                  <div style={{display:'flex',gap:3,marginBottom:10,flexWrap:'wrap'}}>
                    {Object.entries(PIN_COLORS).map(function(e){var k=e[0],c=e[1];var isS=selPt.color===k;return <button key={k} onClick={function(){updatePoint(selPt.id,{color:k});}} style={{fontSize:10,padding:'3px 9px',borderRadius:11,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,display:'flex',alignItems:'center',gap:3,border:isS?'2px solid '+c.bg:'1px solid var(--glass-border)',background:isS?c.bg+'44':'transparent',color:isS?'#fff':'var(--muted)'}}><span style={{width:6,height:6,borderRadius:'50%',background:c.bg}}/>{c.label}</button>;})}
                  </div>
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,marginBottom:5}}>Notes</div>
                  <textarea value={selPt.notes||''} onChange={function(e){updatePoint(selPt.id,{notes:e.target.value});}} placeholder="Add notes..." style={{width:'100%',minHeight:50,padding:9,borderRadius:8,border:'1px solid var(--glass-border)',background:'rgba(255,255,255,0.05)',color:'var(--text)',fontSize:11,fontFamily:'var(--font)',outline:'none',resize:'vertical'}}/>
                  <div style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'var(--muted)',fontWeight:700,margin:'10px 0 5px'}}>Summary</div>
                  <div style={{display:'flex',flexWrap:'wrap'}}>
                    {sel.info.dot.length>0&&<Badge label="DOT" value={sel.info.dot[0].n+' '+Math.round(sel.info.dot[0].d*3.28084)+'ft'} color="#4a9eff"/>}
                    {sel.info.rr.length>0&&<Badge label="RR" value={sel.info.rr[0].o+' '+Math.round(sel.info.rr[0].d*3.28084)+'ft'} color="var(--danger)"/>}
                    {sel.info.transmission.length>0&&<Badge label="Tx" value={Math.round(sel.info.transmission[0].d*3.28084)+'ft'} color="#a855f7"/>}
                    {sel.info.levee.length>0&&<Badge label="Levee" value={Math.round(sel.info.levee[0].d*3.28084)+'ft'} color="var(--warn)"/>}
                    {sel.info.faa.length>0&&<Badge label="FAA" value={(sel.info.faa[0].dist/1609.34).toFixed(1)+'mi'} color="#06b6d4"/>}
                  </div>
                </>:tab==='nearby'?<>
                  <DetailBox title={sel.info.dot.length?'DOT Roads ('+sel.info.dot.length+')':'DOT Roads \u2014 Clear'} color="#4a9eff">{sel.info.dot.map(function(h,i){return <NearbyRow key={i} label={h.n+' ('+h.t+')'+(h.mp?' \u00b7 MP '+h.mp:'')} dist={h.d} dir={h.dir}/>;})}{!sel.info.dot.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 1,640ft</div>}</DetailBox>
                  <DetailBox title={sel.info.rr.length?'Railroads ('+sel.info.rr.length+')':'Railroads \u2014 Clear'} color="var(--danger)">{sel.info.rr.map(function(r,i){return <NearbyRow key={i} label={r.o} dist={r.d} dir={r.dir}/>;})}{!sel.info.rr.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 2,625ft</div>}</DetailBox>
                  <DetailBox title={sel.info.transmission.length?'Transmission ('+sel.info.transmission.length+')':'Transmission \u2014 Clear'} color="#a855f7">{sel.info.transmission.map(function(t,i){return <NearbyRow key={i} label={(t.n||'Line')+(t.v?' ('+t.v+')':'')} dist={t.d} dir={t.dir}/>;})}{!sel.info.transmission.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 2,625ft</div>}</DetailBox>
                  <DetailBox title={sel.info.levee.length?'Levees ('+sel.info.levee.length+')':'Levees \u2014 Clear'} color="var(--warn)">{sel.info.levee.map(function(l,i){return <NearbyRow key={i} label={l.n+(l.s?' ['+l.s+']':'')} dist={l.d} dir={l.dir}/>;})}{!sel.info.levee.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 2,625ft</div>}</DetailBox>
                  <DetailBox title={sel.info.faa.length?'Airports ('+sel.info.faa.length+')':'Airports \u2014 Clear'} color="#06b6d4">{sel.info.faa.map(function(a,i){return <NearbyRow key={i} label={a.n} dist={a.dist} dir={a.brg}/>;})}{!sel.info.faa.length&&<div style={{fontSize:11,color:'var(--muted)'}}>None within 10,000ft</div>}</DetailBox>
                </>:<>
                  {sel.pm&&sel.pm.length>0?sel.pm.map(function(p,i){return <PermitCard key={i} p={p}/>;}):
                  <div style={{fontSize:12,color:'var(--muted)',textAlign:'center',padding:14}}>No permits flagged</div>}
                </>}
              </div>
            </div>
            :pts.length>0&&Object.keys(res).length>0?<div style={{color:'var(--muted)',fontSize:11,textAlign:'center',padding:20}}>Select a location to see its results</div>
            :pts.length>0?<div style={{color:'var(--muted)',fontSize:11,textAlign:'center',padding:20}}>Click <b style={{color:'var(--text)'}}>Analyze</b> to check your locations</div>
            :<div style={{color:'var(--muted)',fontSize:11,textAlign:'center',padding:20}}>Add locations first</div>}
          </div>}
        </div>
        {/* ============ FOOTER ============ */}
        <div style={{borderTop:'1px solid var(--glass-border)',padding:'8px 12px',flexShrink:0}} onDragOver={function(e){e.preventDefault();}} onDrop={function(e){e.preventDefault();var f=e.dataTransfer.files[0];if(f){var n=f.name.toLowerCase();if(n.endsWith('.csv'))handleCSV(f);else if(n.endsWith('.kml')||n.endsWith('.kmz'))handleKMLFile(f);}}}>
          <div style={{display:'flex',gap:4,marginBottom:6}}>
            <button onClick={function(){setPinMode(!pinMode);setMeasureMode(false);setAreaMode(false);}} style={Object.assign({},FBTN,{flex:1},pinMode?{background:'linear-gradient(135deg,var(--accent),var(--accent2))',color:'#fff',border:'1px solid transparent'}:{})}>+ Pin</button>
            <button onClick={function(){setMeasureMode(!measureMode);setPinMode(false);setAreaMode(false);if(measureMode)setMeasurePts([]);}} style={Object.assign({},FBTN,{flex:1},measureMode?{background:'#4a9eff',color:'#fff',border:'1px solid transparent'}:{})}>Measure</button>
            <button onClick={function(){setAreaMode(!areaMode);setPinMode(false);setMeasureMode(false);if(areaMode)setAreaPts([]);}} style={Object.assign({},FBTN,{flex:1},areaMode?{background:'#a855f7',color:'#fff',border:'1px solid transparent'}:{})}>Area</button>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
            <button onClick={function(){fileRef.current&&fileRef.current.click();}} style={FBTN}>Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={function(e){if(e.target.files[0])handleCSV(e.target.files[0]);}}/>
            <button onClick={function(){kmlFileRef.current&&kmlFileRef.current.click();}} style={FBTN}>Import KML</button>
            <input ref={kmlFileRef} type="file" accept=".kml,.kmz" style={{display:'none'}} onChange={function(e){if(e.target.files[0])handleKMLFile(e.target.files[0]);}}/>
            {pts.length>0&&<button onClick={exportCSV} style={FBTN}>Export CSV</button>}
            {pts.length>0&&<button onClick={exportKML} style={Object.assign({},FBTN,{borderColor:'rgba(0,212,170,0.4)',color:'var(--success)'})}>Export KML</button>}
            {pts.length>0&&<button onClick={saveProject} style={FBTN}>Save</button>}
            <button onClick={function(){projFileRef.current&&projFileRef.current.click();}} style={FBTN}>Open</button>
            <input ref={projFileRef} type="file" accept=".json" style={{display:'none'}} onChange={function(e){if(e.target.files[0])loadProject(e.target.files[0]);}}/>
            {pts.length>0&&<button onClick={getShareLink} style={FBTN}>Share</button>}
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
        {pts.length>0&&<div style={{position:'absolute',bottom:18,left:'50%',transform:'translateX(-50%)',display:'flex',gap:8,zIndex:1000,width:'min(420px,70%)'}}>
          <button style={{flex:1,padding:'11px 0',background:busy?'rgba(18,18,26,0.85)':'linear-gradient(135deg,var(--accent),var(--accent2))',color:busy?'var(--muted)':'#fff',border:busy?'1px solid var(--glass-border)':'none',borderRadius:11,fontSize:13,fontWeight:700,fontFamily:'var(--font)',cursor:busy?'default':'pointer',boxShadow:busy?'none':'0 6px 24px rgba(232,67,79,.35)',backdropFilter:'blur(20px)'}} disabled={busy} onClick={analyzeAll}>{busy?statusMsg||'Analyzing...':'Analyze '+pts.length+' Location'+(pts.length>1?'s':'')}</button>
          <button style={{padding:'11px 15px',background:'rgba(18,18,26,0.85)',backdropFilter:'blur(20px)',color:'var(--muted)',border:'1px solid var(--glass-border)',borderRadius:11,fontSize:11,fontFamily:'var(--font)',cursor:'pointer'}} onClick={function(){setPts([]);setRes({});setSelId(null);setSelIds([]);nextId.current=1;}}>Clear</button>
        </div>}
        <div style={{position:'absolute',bottom:18,right:14,zIndex:1000,background:'rgba(18,18,26,0.85)',backdropFilter:'blur(20px)',border:'1px solid var(--glass-border)',borderRadius:10,padding:'6px 12px',fontFamily:'var(--mono)',fontSize:10,color:'var(--muted)',display:'flex',gap:12}}>
          <span>{cursorCoords?cursorCoords.lat+', '+cursorCoords.lng:'\u2014'}</span>
          <span>z{zoomLevel}</span>
          {co&&<span>{co.short}</span>}
          <span>{pts.length} pts{totalPermits>0?' \u00b7 '+totalPermits+' permits':''}</span>
        </div>
      </div>
    </div>
  );
}
