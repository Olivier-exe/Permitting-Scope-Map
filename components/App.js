'use client';
import {useState,useRef,useEffect,useCallback} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {runFullAnalysis,generatePermits,getElevation,reverseGeocode,haversine,bearing,polygonArea,polygonAreaMultiUnit,parseKML} from '../lib/spatial';

var PIN_COLORS = {
  review: {bg:'#f59e0b',label:'Needs Review'},
  approved: {bg:'#10b981',label:'Approved'},
  complete: {bg:'#3b82f6',label:'Complete'},
  issue: {bg:'#ef4444',label:'Issue'},
};

// #11: More basemap options — Google Hybrid, ESRI, OSM
var BASEMAPS = {
  dark: {url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',attr:'CartoDB',label:'Dark',maxZoom:20},
  hybrid: {url:'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',attr:'Google',label:'Hybrid',maxZoom:21},
  satellite: {url:'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',attr:'Google',label:'Satellite',maxZoom:21},
  esri: {url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attr:'ESRI',label:'ESRI',maxZoom:19},
  osm: {url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',attr:'OpenStreetMap',label:'Streets',maxZoom:19},
};

function airportIcon(){return L.divIcon({className:'',html:'<svg width="20" height="20" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0011.5 2 1.5 1.5 0 0010 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#06b6d4" stroke="#fff" stroke-width="0.5"/></svg>',iconSize:[20,20],iconAnchor:[10,10]});}

function Badge({label,value,color}){return <div style={{display:'inline-flex',alignItems:'center',gap:5,background:'var(--card)',padding:'4px 10px',borderRadius:4,margin:'0 5px 5px 0',fontSize:12}}><span style={{color:'var(--text3)'}}>{label}</span><span style={{fontWeight:600,fontFamily:'var(--mono)',color:color||'var(--text3)'}}>{value}</span></div>;}
function PermitCard({p}){var c=({Critical:'#ef4444',High:'#f59e0b',Medium:'#10b981',Low:'#666'})[p.priority]||'#10b981';return <div style={{borderLeft:'3px solid '+c,background:c+'14',padding:'12px 14px',borderRadius:'0 6px 6px 0',marginBottom:8}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}><span style={{fontWeight:700,fontSize:14}}>{p.type}</span><span style={{fontSize:10,fontWeight:700,color:c,border:'1px solid '+c+'40',padding:'2px 8px',borderRadius:20,textTransform:'uppercase'}}>{p.priority}</span></div><div style={{fontSize:12,color:'var(--text2)',marginBottom:4}}>{p.jurisdiction}</div><div style={{fontSize:13,color:'var(--text2)',lineHeight:1.5}}>{p.recommendation}</div>{p.notes&&<div style={{fontSize:12,color:'var(--amber)',marginTop:5,fontStyle:'italic'}}>{p.notes}</div>}</div>;}
function DetailBox({title,color,children}){return <div style={{borderRadius:6,padding:12,marginBottom:10,borderLeft:'3px solid '+color+'50',background:color+'0a'}}><div style={{fontWeight:700,marginBottom:5,fontSize:13,color:color}}>{title}</div>{children}</div>;}
function NearbyRow({label,dist}){var ft=Math.round(dist*3.28084);var dc=ft<150?'var(--red)':ft<650?'var(--amber)':'var(--text2)';return <div style={{fontSize:12,marginBottom:4,display:'flex',justifyContent:'space-between'}}><span>{label}</span><b style={{color:dc,fontFamily:'var(--mono)'}}>{ft>5280?((ft/5280).toFixed(1)+' mi'):(ft+' ft')}</b></div>;}

var S = {
  wrap:{height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'},
  hdr:{height:48,padding:'0 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--panel)',flexShrink:0},
  hdrLeft:{display:'flex',alignItems:'center',gap:10},
  logo:{width:30,height:30,background:'linear-gradient(135deg,var(--green),var(--green2))',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#fff'},
  main:{flex:1,display:'flex',overflow:'hidden'},
  mapWrap:{flex:1,position:'relative'},
  sidebar:{width:400,borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',flexShrink:0,background:'var(--panel)',overflow:'hidden'},
  sidebarScroll:{flex:1,overflowY:'auto'},
  sec:{borderBottom:'1px solid var(--border)',flexShrink:0},
  btn:{fontSize:11,padding:'4px 10px',borderRadius:4,border:'1px solid var(--border)',background:'transparent',color:'var(--text3)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:500},
  actionBar:{position:'absolute',bottom:14,left:14,right:14,display:'flex',gap:8,zIndex:1000},
  btnGo:{flex:1,padding:12,background:'linear-gradient(135deg,var(--green),var(--green2))',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontWeight:700,fontFamily:'var(--font)',cursor:'pointer',boxShadow:'0 4px 20px rgba(0,0,0,.4)'},
  btnClr:{padding:'12px 16px',background:'var(--card)',color:'var(--text3)',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'var(--font)',cursor:'pointer'},
  modeInd:{position:'absolute',top:10,left:10,zIndex:1000,background:'var(--card)',border:'1px solid var(--border2)',borderRadius:8,padding:'8px 14px',fontSize:12,color:'var(--text2)',display:'flex',alignItems:'center',gap:6,boxShadow:'0 4px 16px rgba(0,0,0,.4)'},
  slabel:{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)',marginBottom:6},
  coordBar:{position:'absolute',bottom:50,left:14,zIndex:999,background:'rgba(0,0,0,0.75)',borderRadius:6,padding:'5px 12px',fontSize:12,fontFamily:'var(--mono)',color:'var(--text2)',pointerEvents:'none'},
};

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
  var [searchText,setSearchText]=useState('');
  var [showLegend,setShowLegend]=useState(false);
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

  useEffect(function(){
    fetch('/layers/manifest.json').then(function(r){return r.json();}).then(function(d){
      setManifest(d);var keys=Object.keys(d.companies);
      if(keys.length){setCompany(keys[0]);
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

  // Init map — #10: maxZoom 21
  useEffect(function(){
    if(mapInst.current||!mapRef.current)return;
    var m=L.map(mapRef.current,{zoomControl:false,preferCanvas:true,minZoom:4,maxZoom:21}).setView([31,-92],7);
    L.control.zoom({position:'topright'}).addTo(m);
    tileRef.current=L.tileLayer(BASEMAPS.dark.url,{attribution:BASEMAPS.dark.attr,maxZoom:21}).addTo(m);
    m.on('contextmenu',function(e){e.originalEvent.preventDefault();
      if(m._measureMode){setMeasurePts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      if(m._areaMode){setAreaPts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      setPts(function(prev){return prev.concat([{id:nextId.current++,lat:e.latlng.lat,lng:e.latlng.lng,name:'Pin '+(nextId.current-1),color:'review',notes:''}]);});
    });
    m.on('click',function(e){
      if(m._measureMode){setMeasurePts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      if(m._areaMode){setAreaPts(function(p){return p.concat([[e.latlng.lat,e.latlng.lng]]);});return;}
      if(m._pinMode){
        setPts(function(prev){return prev.concat([{id:nextId.current++,lat:e.latlng.lat,lng:e.latlng.lng,name:'Pin '+(nextId.current-1),color:'review',notes:''}]);});
        m._pinMode=false;setPinMode(false);}
    });
    m.on('mousemove',function(e){setCursorCoords({lat:e.latlng.lat.toFixed(5),lng:e.latlng.lng.toFixed(5)});});
    m.on('mouseout',function(){setCursorCoords(null);});
    mapInst.current=m;return function(){m.remove();mapInst.current=null;};
  },[]);

  useEffect(function(){if(!mapInst.current||!tileRef.current)return;mapInst.current.removeLayer(tileRef.current);var bm=BASEMAPS[basemap];tileRef.current=L.tileLayer(bm.url,{attribution:bm.attr,maxZoom:bm.maxZoom||21}).addTo(mapInst.current);},[basemap]);
  useEffect(function(){if(!mapInst.current||!manifest||!company)return;var co=manifest.companies[company];if(co)mapInst.current.setView(co.center,co.zoom);},[company,manifest]);
  useEffect(function(){if(mapInst.current){mapInst.current._pinMode=pinMode;mapInst.current._measureMode=measureMode;mapInst.current._areaMode=areaMode;}},[pinMode,measureMode,areaMode]);
  useEffect(function(){var h=function(e){if(e.key==='Escape'){setPinMode(false);setMeasureMode(false);setMeasurePts([]);setAreaMode(false);setAreaPts([]);setSelIds([]);}};document.addEventListener('keydown',h);return function(){document.removeEventListener('keydown',h);};},[]);

  // Measure line — #12: also works with existing pins via measurePts
  useEffect(function(){
    if(!mapInst.current)return;var m=mapInst.current;
    if(measureLineRef.current){m.removeLayer(measureLineRef.current);measureLineRef.current=null;}
    measureMarkersRef.current.forEach(function(mk){m.removeLayer(mk);});measureMarkersRef.current=[];
    if(measurePts.length>=2){
      measureLineRef.current=L.polyline(measurePts,{color:'#fff',weight:2,dashArray:'6 4'}).addTo(m);
      var total=0;
      for(var i=1;i<measurePts.length;i++){total+=haversine(measurePts[i-1][0],measurePts[i-1][1],measurePts[i][0],measurePts[i][1]);}
      var brng=bearing(measurePts[0][0],measurePts[0][1],measurePts[measurePts.length-1][0],measurePts[measurePts.length-1][1]);
      var totalFt=total*3.28084;var distStr=totalFt>5280?((totalFt/5280).toFixed(2)+' mi'):(Math.round(totalFt)+' ft');
      var midIdx=Math.floor(measurePts.length/2);var mid=measurePts[midIdx];
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
      var line1=units.acres.toFixed(2)+' ac';
      var line2=units.sqft>100000?(units.sqft/1000000).toFixed(2)+' M sq ft':Math.round(units.sqft).toLocaleString()+' sq ft';
      var line3=units.sqmi>=0.01?units.sqmi.toFixed(3)+' sq mi':'';
      var labelHtml='<div style="background:rgba(0,0,0,0.9);color:#a855f7;padding:6px 10px;border-radius:6px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(168,85,247,0.4);line-height:1.6;box-shadow:0 2px 8px rgba(0,0,0,0.5)">'+line1+'<br><span style="color:#c4b5fd;font-size:11px">'+line2+'</span>'+(line3?'<br><span style="color:#c4b5fd;font-size:11px">'+line3+'</span>':'')+'</div>';
      var mk=L.marker(center,{icon:L.divIcon({className:'',html:labelHtml,iconAnchor:[60,14]})}).addTo(m);
      areaMarkersRef.current.push(mk);
    }
    areaPts.forEach(function(pt){var mk=L.circleMarker(pt,{radius:5,color:'#a855f7',fillColor:'#a855f7',fillOpacity:1,weight:2}).addTo(m);areaMarkersRef.current.push(mk);});
  },[areaPts]);

  // Load layer data
  useEffect(function(){
    if(!manifest||!company)return;var co=manifest.companies[company];var tg=layerToggles[company]||{};
    Object.keys(co.layers).forEach(function(lk){var dk=company+'_'+lk;
      if(tg[lk]&&!layerData[dk]&&!loadingLayers[dk]){
        setLoadingLayers(function(p){var n=Object.assign({},p);n[dk]=true;return n;});
        fetch('/layers/'+co.layers[lk].file).then(function(r){return r.json();}).then(function(data){
          setLayerData(function(p){var n=Object.assign({},p);n[dk]=data;return n;});
          setLoadingLayers(function(p){var n=Object.assign({},p);delete n[dk];return n;});
        }).catch(function(){setLoadingLayers(function(p){var n=Object.assign({},p);delete n[dk];return n;});});
      }
    });
  },[layerToggles,company,manifest,layerData,loadingLayers]);

  // Draw layers — #5/#6: bigger hover targets, brighter colors for satellite, #8: separate city/parish tooltips
  useEffect(function(){
    if(!mapInst.current||!manifest||!company)return;var m=mapInst.current;var co=manifest.companies[company];var tg=layerToggles[company]||{};var op=layerOpacity[company]||{};
    var lookup=lookupData[company]||{};
    Object.keys(layerGroupsRef.current).forEach(function(k){if(layerGroupsRef.current[k]){m.removeLayer(layerGroupsRef.current[k]);delete layerGroupsRef.current[k];}});
    Object.keys(co.layers).forEach(function(lk){
      var dk=company+'_'+lk;if(!tg[lk]||!layerData[dk])return;
      var cfg=co.layers[lk];var data=layerData[dk];var items=[];var opacity=(op[lk]!==undefined?op[lk]:1);
      if(cfg.minZoom&&m.getZoom()<cfg.minZoom){
        var zoomHandler=function(){var g=layerGroupsRef.current[dk];if(m.getZoom()>=cfg.minZoom){if(g&&!m.hasLayer(g))g.addTo(m);}else{if(g&&m.hasLayer(g))m.removeLayer(g);}};
        m.off('zoomend',zoomHandler);m.on('zoomend',zoomHandler);
      }
      if(cfg.type==='line'){
        data.forEach(function(seg){var ll=seg.c.map(function(p){return[p[0],p[1]];});if(ll.length<2)return;
          var clr=typeof cfg.color==='object'?(cfg.color[seg[cfg.colorKey]]||'#888'):cfg.color;
          var wt=typeof cfg.weight==='object'?(cfg.weight[seg[cfg.colorKey]]||2):(cfg.weight||2.5);
          var da=typeof cfg.dash==='object'?(cfg.dash[seg[cfg.colorKey]]||null):(cfg.dash||null);
          var line=L.polyline(ll,{color:clr,weight:wt,opacity:0.9*opacity,dashArray:da});
          // #5: invisible wider polyline for easier hover
          var hitLine=L.polyline(ll,{color:clr,weight:Math.max(wt*3,12),opacity:0,interactive:true});
          var nm=seg[cfg.nameKey]||seg.n||seg.o||'';
          if(nm){hitLine.bindTooltip(nm,{sticky:true,className:'ltip'});line.bindTooltip(nm,{sticky:true,className:'ltip'});}
          hitLine.on('mouseover',function(){line.setStyle({weight:wt+3,opacity:1});});
          hitLine.on('mouseout',function(){line.setStyle({weight:wt,opacity:0.9*opacity});});
          items.push(line);items.push(hitLine);});
      }else if(cfg.type==='point'){
        data.forEach(function(pt){
          var icon=cfg.icon==='airport'?airportIcon():L.divIcon({className:'',html:'<div style="width:8px;height:8px;background:'+cfg.color+';border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px '+cfg.color+';opacity:'+opacity+'"></div>',iconSize:[8,8],iconAnchor:[4,4]});
          var mk=L.marker([pt.lat,pt.lng],{icon:icon});if(pt.n)mk.bindTooltip(pt.n,{className:'ltip'});items.push(mk);});
      }else if(cfg.type==='polygon'){
        data.forEach(function(poly){var ll=poly.c.map(function(p){return[p[0],p[1]];});if(ll.length<3)return;
          var pg=L.polygon(ll,{color:cfg.color,weight:cfg.weight||1.5,fillOpacity:(cfg.fill||0)*opacity,dashArray:cfg.dash||null,opacity:0.8*opacity});
          if(poly.n){
            // #8: Simple tooltip — just show the name, no city-in-parish merging
            var tip='<b>'+poly.n+'</b>';
            if((lk==='parishes'||lk==='counties')&&lookup.parishToCities&&lookup.parishToCities[poly.n]){
              var cs=lookup.parishToCities[poly.n];
              tip='<b>'+poly.n+'</b><br><span style="color:#a0a0a0;font-size:11px">Cities: '+cs.slice(0,8).join(', ')+(cs.length>8?' +more':'')+'</span>';
            }
            if(lk==='cities'&&lookup.cityToParish&&lookup.cityToParish[poly.n]){
              tip='<b>'+poly.n+'</b><br><span style="color:#a0a0a0;font-size:11px">'+(co.name.indexOf('Louisiana')>=0?'Parish':'County')+': '+lookup.cityToParish[poly.n]+'</span>';
            }
            pg.bindTooltip(tip,{sticky:true,className:'ltip'});
            pg.on('mouseover',function(){pg.setStyle({weight:(cfg.weight||1.5)+2,fillOpacity:0.15,opacity:1});});
            pg.on('mouseout',function(){pg.setStyle({weight:cfg.weight||1.5,fillOpacity:(cfg.fill||0)*opacity,opacity:0.8*opacity});});
          }
          items.push(pg);});
      }
      if(items.length){var group=L.layerGroup(items);group.addTo(m);layerGroupsRef.current[dk]=group;}
    });
  },[layerToggles,company,manifest,layerData,layerOpacity,lookupData]);

  // Draw markers + pin-to-pin measure lines — #4: rings removed
  useEffect(function(){
    if(!mapInst.current)return;var m=mapInst.current;
    markersRef.current.forEach(function(mk){m.removeLayer(mk);});markersRef.current=[];
    pinMeasureLinesRef.current.forEach(function(l){m.removeLayer(l);});pinMeasureLinesRef.current=[];
    pts.forEach(function(pt){
      var has=res[pt.id],isSel=selId===pt.id,isMultiSel=selIds.indexOf(pt.id)>=0,sz=isSel?22:isMultiSel?20:16;
      var clr=has?(PIN_COLORS[pt.color]||PIN_COLORS.review).bg:'#f59e0b';
      if(isSel)clr='#ef4444'; else if(isMultiSel)clr='#60a5fa';
      var icon=L.divIcon({className:'cm',html:'<div style="width:'+sz+'px;height:'+sz+'px;background:'+clr+';border:3px solid #fff;border-radius:50%;box-shadow:0 0 '+(isSel?16:isMultiSel?12:8)+'px '+clr+',0 2px 6px rgba(0,0,0,.6);cursor:pointer"></div>',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
      var mk=L.marker([pt.lat,pt.lng],{icon:icon}).addTo(m).on('click',function(e){
        // #12: In measure mode, clicking a pin adds it as a measure point
        if(mapInst.current._measureMode){
          setMeasurePts(function(p){return p.concat([[pt.lat,pt.lng]]);});return;
        }
        if(e.originalEvent.shiftKey){
          setSelIds(function(prev){return prev.indexOf(pt.id)>=0?prev.filter(function(x){return x!==pt.id;}):prev.concat([pt.id]);});
        }else{
          setSelId(pt.id);setSelIds([]);
        }
      });
      mk.bindTooltip(pt.name,{permanent:false,direction:'top',offset:[0,-12],className:'ltip'});
      markersRef.current.push(mk);
    });
    // Draw lines between multi-selected pins with distances
    if(selIds.length>=2){
      var selPts=selIds.map(function(id){return pts.find(function(p){return p.id===id;});}).filter(Boolean);
      for(var i=0;i<selPts.length-1;i++){
        var a=selPts[i],b=selPts[i+1];var dist=haversine(a.lat,a.lng,b.lat,b.lng);
        var distFt=Math.round(dist*3.28084);var distStr=distFt>5280?((distFt/5280).toFixed(2)+' mi'):(distFt+' ft');
        var brng=bearing(a.lat,a.lng,b.lat,b.lng);
        var line=L.polyline([[a.lat,a.lng],[b.lat,b.lng]],{color:'#60a5fa',weight:2,dashArray:'6 4',opacity:0.9}).addTo(m);
        var midLat=(a.lat+b.lat)/2,midLng=(a.lng+b.lng)/2;
        var label=L.marker([midLat,midLng],{icon:L.divIcon({className:'',html:'<div style="background:rgba(0,0,0,0.9);color:#60a5fa;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:600;border:1px solid rgba(96,165,250,0.3);box-shadow:0 2px 6px rgba(0,0,0,0.5)">'+distStr+' | '+brng.toFixed(1)+'\u00b0</div>',iconAnchor:[60,-10]}),interactive:false}).addTo(m);
        pinMeasureLinesRef.current.push(line);pinMeasureLinesRef.current.push(label);
      }
      if(selPts.length>=3){
        var totalDist=0;for(var j=0;j<selPts.length-1;j++){totalDist+=haversine(selPts[j].lat,selPts[j].lng,selPts[j+1].lat,selPts[j+1].lng);}
        var totalFt=Math.round(totalDist*3.28084);var totalStr=totalFt>5280?((totalFt/5280).toFixed(2)+' mi'):(totalFt+' ft');
        var lastPt=selPts[selPts.length-1];
        var totalLabel=L.marker([lastPt.lat,lastPt.lng],{icon:L.divIcon({className:'',html:'<div style="background:rgba(0,0,0,0.9);color:#fff;padding:4px 10px;border-radius:5px;font-size:12px;font-family:var(--mono);white-space:nowrap;font-weight:700;border:1px solid rgba(255,255,255,0.2);box-shadow:0 2px 6px rgba(0,0,0,0.5)">Total: '+totalStr+'</div>',iconAnchor:[50,20]}),interactive:false}).addTo(m);
        pinMeasureLinesRef.current.push(totalLabel);
      }
    }
  },[pts,selId,selIds,res]);

  // Handlers — #9: fix import after clear
  var handleCSV=useCallback(function(file){
    setErr('');var reader=new FileReader();reader.onload=function(e){
      var lines=e.target.result.trim().split(/\r?\n/);if(lines.length<2){setErr('Need 2+ rows');return;}
      var h=lines[0].split(',').map(function(s){return s.trim().toLowerCase().replace(/['"]/g,'');});
      var li=h.findIndex(function(x){return['lat','latitude','y'].indexOf(x)>=0;});
      var lo=h.findIndex(function(x){return['lng','lon','long','longitude','x'].indexOf(x)>=0;});
      var ni=h.findIndex(function(x){return['name','label','id','station','site','location','station_id'].indexOf(x)>=0;});
      if(li<0||lo<0){setErr('Need lat + lng columns');return;}
      nextId.current=1;
      var np=[];for(var i=1;i<lines.length;i++){var c=lines[i].split(',').map(function(s){return s.trim().replace(/['"]/g,'');});var la=parseFloat(c[li]),ln=parseFloat(c[lo]);if(!isNaN(la)&&!isNaN(ln))np.push({id:nextId.current++,lat:la,lng:ln,name:ni>=0&&c[ni]?c[ni]:'Point '+(np.length+1),color:'review',notes:''});}
      if(!np.length){setErr('No valid coordinates');return;}
      setPts(np);setRes({});setSelId(null);setSelIds([]);};reader.readAsText(file);
    if(fileRef.current)fileRef.current.value='';
  },[]);

  var loadJSZip=useCallback(function(){
    return new Promise(function(resolve,reject){
      if(window.JSZip){resolve(window.JSZip);return;}
      var script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload=function(){resolve(window.JSZip);};script.onerror=function(){reject(new Error('Failed to load JSZip'));};
      document.head.appendChild(script);
    });
  },[]);

  var handleKMLFile=useCallback(function(file){
    setErr('');var name=file.name.toLowerCase();
    if(name.endsWith('.kmz')){
      loadJSZip().then(function(JSZip){
        var reader=new FileReader();reader.onload=function(e){
          JSZip.loadAsync(e.target.result).then(function(zip){
            var kmlFile=zip.file(/\.kml$/i)[0];if(!kmlFile){setErr('No KML found in KMZ');return;}
            kmlFile.async('string').then(function(text){
              var points=parseKML(text);if(!points||!points.length){setErr('No coordinates found in KML');return;}
              nextId.current=1;
              var np=points.map(function(p){return{id:nextId.current++,lat:p.lat,lng:p.lng,name:p.name,color:'review',notes:''};});
              setPts(np);setRes({});setSelId(null);setSelIds([]);
            });
          }).catch(function(){setErr('Failed to read KMZ');});
        };reader.readAsArrayBuffer(file);
      }).catch(function(){setErr('Could not load KMZ support');});
    }else{
      var reader=new FileReader();reader.onload=function(e){
        var points=parseKML(e.target.result);if(!points||!points.length){setErr('No coordinates found in KML');return;}
        nextId.current=1;
        var np=points.map(function(p){return{id:nextId.current++,lat:p.lat,lng:p.lng,name:p.name,color:'review',notes:''};});
        setPts(np);setRes({});setSelId(null);setSelIds([]);
      };reader.readAsText(file);
    }
    if(kmlFileRef.current)kmlFileRef.current.value='';
  },[]);

  var removePoint=useCallback(function(id){setPts(function(p){return p.filter(function(x){return x.id!==id;});});setRes(function(p){var n=Object.assign({},p);delete n[id];return n;});if(selId===id)setSelId(null);setSelIds(function(p){return p.filter(function(x){return x!==id;});});},[selId]);
  var updatePoint=useCallback(function(id,updates){setPts(function(p){return p.map(function(pt){return pt.id===id?Object.assign({},pt,updates):pt;});});},[]);

  var handleSearch=useCallback(function(){
    if(!searchText.trim()||!mapInst.current)return;
    fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(searchText)+'&limit=1').then(function(r){return r.json();}).then(function(data){
      if(data&&data.length){var r=data[0];var lat=parseFloat(r.lat),lng=parseFloat(r.lon);
        setPts(function(p){return p.concat([{id:nextId.current++,lat:lat,lng:lng,name:searchText,color:'review',notes:''}]);});
        mapInst.current.setView([lat,lng],13);setSearchText('');setErr('');}
      else{setErr('Location not found');}
    }).catch(function(){setErr('Search failed');});
  },[searchText]);

  var exportCSV=useCallback(function(){
    if(!pts.length)return;
    var lines=['name,latitude,longitude,color,notes,address,city,county,state,nearest_dot,nearest_rr,nearest_transmission,elevation_ft'];
    pts.forEach(function(pt){var r=res[pt.id];var info=r?r.info:null;
      var row=[pt.name,pt.lat,pt.lng,pt.color||'review',pt.notes||'',info?info.address||'':'',info?info.city||'':'',info?info.county||'':'',info?info.state||'':'',
        info&&info.dot.length?info.dot[0].n+' ('+info.dot[0].d+'m)':'',info&&info.rr.length?info.rr[0].o+' ('+info.rr[0].d+'m)':'',
        info&&info.transmission.length?info.transmission[0].n+' ('+info.transmission[0].d+'m)':'',info&&info.elevation?info.elevation.ft.toFixed(1):''];
      lines.push(row.map(function(v){return'"'+String(v).replace(/"/g,'""')+'"';}).join(','));
    });
    var blob=new Blob([lines.join('\n')],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='scope_analysis.csv';a.click();URL.revokeObjectURL(url);
  },[pts,res]);

  var saveProject=useCallback(function(){var proj={pts:pts,res:res,company:company};var blob=new Blob([JSON.stringify(proj)],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='scope_project.json';a.click();URL.revokeObjectURL(url);},[pts,res,company]);

  var loadProject=useCallback(function(file){
    var reader=new FileReader();reader.onload=function(e){
      try{var proj=JSON.parse(e.target.result);if(proj.pts){nextId.current=1;proj.pts.forEach(function(p){if(p.id>=nextId.current)nextId.current=p.id+1;});setPts(proj.pts);}if(proj.res)setRes(proj.res);if(proj.company)setCompany(proj.company);}catch(ex){setErr('Invalid project file');}
    };reader.readAsText(file);
  },[]);

  var detectCompany=useCallback(function(lat,lng){
    if(!manifest)return company;
    var regions={entergy_la:{minLat:28.5,maxLat:33.2,minLng:-94.1,maxLng:-88.7},entergy_tx:{minLat:29.0,maxLat:31.5,minLng:-96.0,maxLng:-93.5},exel_nm:{minLat:31.3,maxLat:37.0,minLng:-109.1,maxLng:-103.0},exel_tx:{minLat:25.8,maxLat:36.5,minLng:-106.7,maxLng:-93.5}};
    var order=['entergy_la','entergy_tx','exel_nm','exel_tx'];
    for(var i=0;i<order.length;i++){var k=order[i],b=regions[k];if(manifest.companies[k]&&lat>=b.minLat&&lat<=b.maxLat&&lng>=b.minLng&&lng<=b.maxLng)return k;}
    return company;
  },[manifest,company]);

  // Optimized analysis: batch local + parallel external
  var analyzeAll=useCallback(async function(){
    if(!pts.length||!company||!manifest)return;setBusy(true);var newRes={};
    setStatusMsg('Loading layers...');
    var neededLayers={};
    for(var i=0;i<pts.length;i++){
      var ptCompany=detectCompany(pts[i].lat,pts[i].lng);var co=manifest.companies[ptCompany];
      if(co){['dot','rr','transmission','levee','faa','cities','parishes','counties','row','parish_roads'].forEach(function(lk){var dk=ptCompany+'_'+lk;if(co.layers[lk]&&!layerData[dk]&&!neededLayers[dk])neededLayers[dk]={file:co.layers[lk].file};});}
    }
    var layerKeys=Object.keys(neededLayers);
    if(layerKeys.length){
      var lr=await Promise.all(layerKeys.map(function(dk){return fetch('/layers/'+neededLayers[dk].file).then(function(r){return r.json();}).then(function(d){return{dk:dk,data:d};}).catch(function(){return null;});}));
      lr.forEach(function(r){if(r)setLayerData(function(p){var n=Object.assign({},p);n[r.dk]=r.data;return n;});});
    }
    setStatusMsg('Running spatial analysis...');
    var localResults=[];
    for(var i=0;i<pts.length;i++){var pt=pts[i];var ptCompany=detectCompany(pt.lat,pt.lng);var r=runFullAnalysis(pt.lat,pt.lng,layerData,ptCompany,manifest);if(r)r.detectedCompany=ptCompany;localResults.push({pt:pt,info:r});}
    setStatusMsg('Fetching elevation & addresses ('+pts.length+')...');
    var finalResults=await Promise.all(localResults.map(function(lr){
      if(!lr.info)return Promise.resolve(lr);
      return Promise.all([getElevation(lr.pt.lat,lr.pt.lng),reverseGeocode(lr.pt.lat,lr.pt.lng)]).then(function(r){if(r[0])lr.info.elevation=r[0];if(r[1])lr.info.address=r[1];return lr;});
    }));
    finalResults.forEach(function(lr){var pm=lr.info?generatePermits(lr.info):[];newRes[lr.pt.id]={info:lr.info,pm:pm};});
    setRes(Object.assign({},newRes));setBusy(false);setStatusMsg('');if(pts.length&&!selId)setSelId(pts[0].id);
  },[pts,company,manifest,layerData,selId,detectCompany]);

  var getShareLink=useCallback(function(){
    if(!pts.length)return;var params=pts.map(function(p){return p.lat.toFixed(5)+','+p.lng.toFixed(5)+','+encodeURIComponent(p.name);}).join('|');
    var url=window.location.origin+'?pins='+params+'&co='+(company||'');
    navigator.clipboard.writeText(url).then(function(){setStatusMsg('Link copied!');setTimeout(function(){setStatusMsg('');},2000);});
  },[pts,company]);

  useEffect(function(){
    var params=new URLSearchParams(window.location.search);var pinStr=params.get('pins');var coStr=params.get('co');
    if(pinStr){var pinArr=pinStr.split('|').map(function(p){var parts=p.split(',');return{id:nextId.current++,lat:parseFloat(parts[0]),lng:parseFloat(parts[1]),name:decodeURIComponent(parts[2]||'Pin'),color:'review',notes:''};});setPts(pinArr);}
    if(coStr&&manifest){setCompany(coStr);}
  },[manifest]);

  var sel=selId?res[selId]:null;var selPt=pts.find(function(p){return p.id===selId;});
  var co=manifest&&company?manifest.companies[company]:null;
  var tg=layerToggles[company]||{};var op=layerOpacity[company]||{};
  var anyLoading=Object.keys(loadingLayers).length>0;
  var totalPermits=Object.values(res).reduce(function(s,r){return s+(r.pm?r.pm.length:0);},0);

  return (
    <div style={S.wrap}>
      <div style={S.hdr}>
        <div style={S.hdrLeft}>
          <div style={S.logo}>&#9889;</div>
          <div><div style={{fontWeight:700,fontSize:16}}>Permitting Scope Map</div>
          <div style={{fontSize:11,color:'var(--text3)'}}>{co?co.name:'Loading...'}{anyLoading?' \u2022 Loading...':''}{statusMsg?' \u2022 '+statusMsg:''}</div></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          {manifest&&Object.entries(manifest.companies).map(function(e){var k=e[0],c=e[1];return <button key={k} onClick={function(){setCompany(k);}} style={{fontSize:11,padding:'4px 12px',borderRadius:4,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:company===k?'1px solid var(--green)':'1px solid var(--border)',background:company===k?'rgba(16,185,129,0.1)':'transparent',color:company===k?'var(--green)':'var(--text3)'}}>{c.short}</button>;})}
          <div style={{display:'flex',gap:4,marginLeft:6}}>
            {Object.entries(BASEMAPS).map(function(e){var k=e[0],bm=e[1];return <button key={k} onClick={function(){setBasemap(k);}} style={{fontSize:11,padding:'4px 10px',borderRadius:4,cursor:'pointer',fontFamily:'var(--font)',fontWeight:500,border:basemap===k?'1px solid var(--green)':'1px solid var(--border)',background:basemap===k?'rgba(16,185,129,0.08)':'transparent',color:basemap===k?'var(--green)':'var(--text3)'}}>{bm.label}</button>;})}
          </div>
        </div>
      </div>

      <div style={S.main}>
        <div style={S.mapWrap}>
          <div ref={mapRef} style={{width:'100%',height:'100%',cursor:measureMode?'crosshair':areaMode?'crosshair':pinMode?'crosshair':'grab'}}/>
          {cursorCoords&&<div style={S.coordBar}>{cursorCoords.lat}, {cursorCoords.lng}</div>}
          {pinMode&&<div style={S.modeInd}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',animation:'pulse 1.5s infinite'}}/> Click to drop pin &#8212; Esc to cancel</div>}
          {measureMode&&<div style={Object.assign({},S.modeInd,{background:'rgba(59,130,246,0.9)',border:'1px solid var(--blue)'})}><span style={{width:8,height:8,borderRadius:'50%',background:'#fff',animation:'pulse 1.5s infinite'}}/> Click map or existing pins to measure &#8212; Esc to stop ({measurePts.length} pts)</div>}
          {areaMode&&<div style={Object.assign({},S.modeInd,{background:'rgba(168,85,247,0.9)',border:'1px solid #a855f7'})}><span style={{width:8,height:8,borderRadius:'50%',background:'#fff',animation:'pulse 1.5s infinite'}}/> Click to draw area &#8212; Esc to stop ({areaPts.length} pts)</div>}
          {pts.length>0&&<div style={S.actionBar}>
            <button style={Object.assign({},S.btnGo,busy?{background:'var(--card)',color:'var(--text3)',cursor:'default',boxShadow:'none'}:{})} disabled={busy} onClick={analyzeAll}>{busy?statusMsg||'Analyzing...':'Analyze '+pts.length+' Location'+(pts.length>1?'s':'')}</button>
            <button style={S.btnClr} onClick={function(){setPts([]);setRes({});setSelId(null);setSelIds([]);nextId.current=1;}}>Clear All</button>
          </div>}
        </div>

        <div style={S.sidebar}>
          <div style={S.sidebarScroll}>
          <div style={Object.assign({},S.sec,{padding:'8px 12px'})}>
            <div style={{display:'flex',gap:6}}>
              <input value={searchText} onChange={function(e){setSearchText(e.target.value);setErr('');}} onKeyDown={function(e){if(e.key==='Enter')handleSearch();}} placeholder="Search address or location..." style={{flex:1,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',color:'var(--text)',fontSize:13,fontFamily:'var(--font)',outline:'none'}}/>
              <button onClick={handleSearch} style={{fontSize:12,padding:'7px 14px',borderRadius:6,background:'var(--green)',color:'#fff',border:'none',fontWeight:600,cursor:'pointer',fontFamily:'var(--font)'}}>Go</button>
            </div>
            {err&&<div style={{color:'var(--red)',fontSize:12,marginTop:4}}>{err}</div>}
          </div>

          <div style={Object.assign({},S.sec,{padding:'8px 12px'})}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <span style={S.slabel}>Layers</span>
              <button onClick={function(){setShowLegend(!showLegend);}} style={{fontSize:10,color:'var(--text3)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>{showLegend?'Hide Legend':'Legend'}</button>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
              {co&&Object.entries(co.layers).map(function(e){
                var lk=e[0],lcfg=e[1];var active=tg[lk];var clr=typeof lcfg.color==='object'?'#4a9eff':lcfg.color;
                return <button key={lk} onClick={function(){setLayerToggles(function(p){var n=Object.assign({},p);n[company]=Object.assign({},n[company]);n[company][lk]=!n[company][lk];return n;});}} style={{fontSize:11,padding:'4px 10px',borderRadius:12,border:'1px solid '+(active?clr+'66':'var(--border)'),background:active?clr+'14':'transparent',color:active?clr:'var(--text3)',cursor:'pointer',fontFamily:'var(--font)',fontWeight:500,display:'flex',alignItems:'center',gap:4}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:clr,opacity:active?1:0.3}}/>{lcfg.label}{loadingLayers[company+'_'+lk]?' ...':''}
                </button>;
              })}
            </div>
            {co&&Object.entries(co.layers).filter(function(e){return tg[e[0]];}).map(function(e){
              var lk=e[0],lcfg=e[1];var clr=typeof lcfg.color==='object'?'#4a9eff':lcfg.color;
              return <div key={lk+'_op'} style={{display:'flex',alignItems:'center',gap:8,marginTop:4,fontSize:11}}>
                <span style={{color:clr,minWidth:70}}>{lcfg.label}</span>
                <input type="range" min="0" max="100" value={Math.round((op[lk]||1)*100)} onChange={function(ev){setLayerOpacity(function(p){var n=Object.assign({},p);n[company]=Object.assign({},n[company]);n[company][lk]=parseInt(ev.target.value)/100;return n;});}} style={{flex:1,height:4,accentColor:clr}}/>
                <span style={{color:'var(--text3)',fontFamily:'var(--mono)',minWidth:30,textAlign:'right',fontSize:10}}>{Math.round((op[lk]||1)*100)}%</span>
              </div>;
            })}
            {showLegend&&co&&<div style={{marginTop:8,padding:10,background:'var(--card)',borderRadius:6,fontSize:12}}>
              {Object.entries(co.layers).map(function(e){var lk=e[0],lcfg=e[1];
                if(typeof lcfg.color==='object'){return <div key={lk} style={{marginBottom:4}}><div style={{fontWeight:600,marginBottom:2}}>{lcfg.label}:</div>{Object.entries(lcfg.color).map(function(ce){return <div key={ce[0]} style={{display:'flex',alignItems:'center',gap:6,marginLeft:8,marginBottom:1}}><span style={{width:16,height:3,background:ce[1],borderRadius:2,display:'inline-block'}}/><span>{ce[0]==='I'?'Interstate':ce[0]==='U'?'US Highway':'State/Local'}</span></div>;})}</div>;}
                var clr=lcfg.color;
                return <div key={lk} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>{lcfg.type==='point'?<span style={{width:8,height:8,borderRadius:'50%',background:clr,display:'inline-block'}}/>:lcfg.type==='polygon'?<span style={{width:16,height:10,border:'2px solid '+clr,borderRadius:2,display:'inline-block'}}/>:<span style={{width:16,height:3,background:clr,borderRadius:2,display:'inline-block'}}/>}<span>{lcfg.label}</span></div>;
              })}
            </div>}
          </div>

          <div style={Object.assign({},S.sec,{padding:'6px 12px'})}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)'}}>Tools</span>
              <div style={{display:'flex',gap:4}}>
                <button onClick={function(){setPinMode(!pinMode);setMeasureMode(false);setAreaMode(false);}} style={Object.assign({},S.btn,pinMode?{background:'var(--green)',color:'#fff',border:'none'}:{})}>+ Pin</button>
                <button onClick={function(){setMeasureMode(!measureMode);setPinMode(false);setAreaMode(false);if(measureMode)setMeasurePts([]);}} style={Object.assign({},S.btn,measureMode?{background:'var(--blue)',color:'#fff',border:'none'}:{})}>Measure</button>
                <button onClick={function(){setAreaMode(!areaMode);setPinMode(false);setMeasureMode(false);if(areaMode)setAreaPts([]);}} style={Object.assign({},S.btn,areaMode?{background:'#a855f7',color:'#fff',border:'none'}:{})}>Area</button>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)'}}>Import / Export</span>
              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                <button onClick={function(){fileRef.current&&fileRef.current.click();}} style={S.btn}>Import CSV</button>
                <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={function(e){if(e.target.files[0])handleCSV(e.target.files[0]);}}/>
                <button onClick={function(){kmlFileRef.current&&kmlFileRef.current.click();}} style={S.btn}>Import KML</button>
                <input ref={kmlFileRef} type="file" accept=".kml,.kmz" style={{display:'none'}} onChange={function(e){if(e.target.files[0])handleKMLFile(e.target.files[0]);}}/>
                {pts.length>0&&<button onClick={exportCSV} style={S.btn}>Export CSV</button>}
                {pts.length>0&&<button onClick={saveProject} style={S.btn}>Save Project</button>}
                <button onClick={function(){projFileRef.current&&projFileRef.current.click();}} style={S.btn}>Open Project</button>
                <input ref={projFileRef} type="file" accept=".json" style={{display:'none'}} onChange={function(e){if(e.target.files[0])loadProject(e.target.files[0]);}}/>
                {pts.length>0&&<button onClick={getShareLink} style={S.btn}>Share Link</button>}
              </div>
            </div>
          </div>

          <div style={Object.assign({},S.sec,{padding:'6px 12px',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
            <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)'}}>Locations ({pts.length}){selIds.length>0?' \u2022 '+selIds.length+' selected':''}</span>
            {totalPermits>0&&<span style={{fontSize:11,color:'var(--amber)'}}>{totalPermits} permits</span>}
          </div>

          {selIds.length>0&&<div style={Object.assign({},S.sec,{padding:'6px 12px',background:'rgba(96,165,250,0.08)',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'})}>
            <span style={{fontSize:11,color:'#60a5fa',fontWeight:600}}>{selIds.length} selected:</span>
            {Object.entries(PIN_COLORS).map(function(e){var k=e[0],c=e[1];
              return <button key={k} onClick={function(){selIds.forEach(function(id){updatePoint(id,{color:k});});setSelIds([]);}} style={{fontSize:10,padding:'3px 8px',borderRadius:10,cursor:'pointer',fontFamily:'var(--font)',fontWeight:500,display:'flex',alignItems:'center',gap:3,border:'1px solid '+c.bg+'55',background:c.bg+'22',color:c.bg}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:c.bg}}/>{c.label}
              </button>;
            })}
            <button onClick={function(){selIds.forEach(function(id){removePoint(id);});setSelIds([]);}} style={{fontSize:10,padding:'3px 8px',borderRadius:10,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600,border:'1px solid var(--red)',background:'rgba(239,68,68,0.15)',color:'var(--red)'}}>Delete</button>
            <button onClick={function(){setSelIds([]);}} style={{fontSize:10,padding:'3px 8px',borderRadius:10,cursor:'pointer',fontFamily:'var(--font)',fontWeight:500,border:'1px solid var(--border)',background:'transparent',color:'var(--text3)'}}>Clear</button>
          </div>}

          <div style={Object.assign({},S.sec,{maxHeight:180,overflowY:'auto'})}>
            {pts.length===0?(
              <div style={{padding:'14px',textAlign:'center'}} onDragOver={function(e){e.preventDefault();}} onDrop={function(e){e.preventDefault();var f=e.dataTransfer.files[0];if(f){var n=f.name.toLowerCase();if(n.endsWith('.csv'))handleCSV(f);else if(n.endsWith('.kml')||n.endsWith('.kmz'))handleKMLFile(f);}}}>
                <div style={{fontSize:12,color:'var(--text3)',lineHeight:1.7}}>Right-click map, search, or import CSV / KML</div>
              </div>
            ):pts.map(function(pt){
              var pc=PIN_COLORS[pt.color]||PIN_COLORS.review;var isSel=selId===pt.id;var isMulti=selIds.indexOf(pt.id)>=0;
              return <div key={pt.id} onClick={function(e){if(e.shiftKey){setSelIds(function(prev){return prev.indexOf(pt.id)>=0?prev.filter(function(x){return x!==pt.id;}):prev.concat([pt.id]);});}else{setSelId(pt.id);setSelIds([]);}}} style={{padding:'5px 8px 5px 12px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',borderLeft:isSel?'3px solid var(--green)':isMulti?'3px solid #60a5fa':'3px solid transparent',background:isSel?'rgba(255,255,255,.03)':isMulti?'rgba(96,165,250,.06)':'transparent'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flex:1,minWidth:0}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:isMulti?'#60a5fa':pc.bg,flexShrink:0}}/>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pt.name}</div>
                    <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>{pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                  {res[pt.id]&&<div style={{width:7,height:7,borderRadius:'50%',background:'var(--green)'}}/>}
                  <button onClick={function(e){e.stopPropagation();removePoint(pt.id);}} style={{width:18,height:18,borderRadius:4,border:'none',background:'transparent',color:'var(--text3)',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}} title="Remove">&#215;</button>
                </div>
              </div>;
            })}
          </div>

          {sel&&<div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0}}>
            {['info','nearby','permits'].map(function(t){return <button key={t} onClick={function(){setTab(t);}} style={{flex:1,padding:'7px 0',fontSize:12,fontWeight:600,fontFamily:'var(--font)',background:'transparent',border:'none',borderBottom:tab===t?'2px solid var(--green)':'2px solid transparent',color:tab===t?'var(--text)':'var(--text3)',cursor:'pointer'}}>{t==='info'?'Location':t==='nearby'?'Nearby':'Permits'}</button>;})}
          </div>}

          <div style={{padding:12}}>
            {sel&&sel.info&&selPt?(
              tab==='info'?<>
                <div style={S.slabel}>Location</div>
                <div style={{background:'var(--card)',borderRadius:8,padding:14,marginBottom:12}}>
                  <input value={selPt.name} onChange={function(e){updatePoint(selPt.id,{name:e.target.value});}} style={{fontWeight:700,fontSize:16,marginBottom:10,background:'transparent',border:'none',borderBottom:'1px solid var(--border)',color:'var(--text)',width:'100%',outline:'none',fontFamily:'var(--font)',padding:'2px 0'}}/>
                  {sel.info.address&&<div style={{fontSize:12,color:'var(--text2)',marginBottom:8,padding:'6px 8px',background:'var(--card2)',borderRadius:4,lineHeight:1.5}}>
                    <span style={{color:'var(--text3)',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Address</span><br/>{sel.info.address}
                  </div>}
                  {[['Coordinates',selPt.lat.toFixed(5)+', '+selPt.lng.toFixed(5),'var(--text)'],
                    ['State',sel.info.state||'\u2014','var(--text)'],
                    [sel.info.state==='Louisiana'?'Parish':'County',sel.info.county||'\u2014','var(--blue)'],
                    ['City',sel.info.city||'Unincorporated','var(--green)'],
                    ['Company',co?co.name:'\u2014','var(--text)']
                  ].concat(sel.info.row?[['ROW Agent',sel.info.row,'#f472b6']]:[])
                  .concat(sel.info.elevation?[['Elevation (NAVD88)',sel.info.elevation.ft.toFixed(1)+' ft','#06b6d4']]:[])
                  .map(function(r,i){return <div key={i} style={{fontSize:13,padding:'4px 0',display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--text3)'}}>{r[0]}</span><span style={{fontWeight:600,fontFamily:'var(--mono)',color:r[2]}}>{r[1]}</span></div>;})}
                </div>
                <div style={S.slabel}>Status</div>
                <div style={{display:'flex',gap:4,marginBottom:12,flexWrap:'wrap'}}>
                  {Object.entries(PIN_COLORS).map(function(e){var k=e[0],c=e[1];var isSel=selPt.color===k;
                    return <button key={k} onClick={function(){updatePoint(selPt.id,{color:k});}} style={{fontSize:11,padding:'4px 10px',borderRadius:12,cursor:'pointer',fontFamily:'var(--font)',fontWeight:500,display:'flex',alignItems:'center',gap:4,border:isSel?'2px solid '+c.bg:'1px solid var(--border)',background:isSel?c.bg+'44':'transparent',color:isSel?'#fff':'var(--text3)'}}>
                      <span style={{width:8,height:8,borderRadius:'50%',background:c.bg}}/>{c.label}
                    </button>;
                  })}
                </div>
                <div style={S.slabel}>Notes</div>
                <textarea value={selPt.notes||''} onChange={function(e){updatePoint(selPt.id,{notes:e.target.value});}} placeholder="Add notes about this location..." style={{width:'100%',minHeight:60,padding:10,borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',color:'var(--text)',fontSize:12,fontFamily:'var(--font)',outline:'none',resize:'vertical'}}/>
                <div style={Object.assign({},S.slabel,{marginTop:12})}>Quick Summary</div>
                <div style={{display:'flex',flexWrap:'wrap'}}>
                  {sel.info.dot.length>0&&<Badge label="DOT" value={sel.info.dot[0].n+' '+Math.round(sel.info.dot[0].d*3.28084)+'ft'} color="var(--blue)"/>}
                  {sel.info.rr.length>0&&<Badge label="RR" value={sel.info.rr[0].o+' '+Math.round(sel.info.rr[0].d*3.28084)+'ft'} color="var(--red)"/>}
                  {sel.info.transmission.length>0&&<Badge label="Trans" value={Math.round(sel.info.transmission[0].d*3.28084)+'ft'} color="#a855f7"/>}
                  {sel.info.levee.length>0&&<Badge label="Levee" value={Math.round(sel.info.levee[0].d*3.28084)+'ft'} color="var(--amber)"/>}
                  {sel.info.faa.length>0&&<Badge label="Airport" value={(sel.info.faa[0].dist/1609.34).toFixed(1)+' mi'} color="#06b6d4"/>}
                </div>
              </>:tab==='nearby'?<>
                <div style={S.slabel}>Nearby Features</div>
                <DetailBox title={sel.info.dot.length?'DOT Roads ('+sel.info.dot.length+')':'DOT Roads \u2014 Clear'} color="var(--blue)">
                  {sel.info.dot.map(function(h,i){return <NearbyRow key={i} label={h.n+' ('+h.t+')'} dist={h.d}/>;})}
                  {!sel.info.dot.length&&<div style={{fontSize:12,color:'var(--text3)'}}>None within 1,640ft</div>}
                </DetailBox>
                <DetailBox title={sel.info.rr.length?'Railroads ('+sel.info.rr.length+')':'Railroads \u2014 Clear'} color="var(--red)">
                  {sel.info.rr.map(function(r,i){return <NearbyRow key={i} label={r.o} dist={r.d}/>;})}
                  {!sel.info.rr.length&&<div style={{fontSize:12,color:'var(--text3)'}}>None within 2,625ft</div>}
                </DetailBox>
                <DetailBox title={sel.info.transmission.length?'Transmission ('+sel.info.transmission.length+')':'Transmission \u2014 Clear'} color="#a855f7">
                  {sel.info.transmission.map(function(t,i){return <NearbyRow key={i} label={(t.n||'Line')+(t.v?' ('+t.v+')':'')} dist={t.d}/>;})}
                  {!sel.info.transmission.length&&<div style={{fontSize:12,color:'var(--text3)'}}>None within 2,625ft</div>}
                </DetailBox>
                <DetailBox title={sel.info.levee.length?'Levees ('+sel.info.levee.length+')':'Levees \u2014 Clear'} color="var(--amber)">
                  {sel.info.levee.map(function(l,i){return <NearbyRow key={i} label={l.n+(l.s?' ['+l.s+']':'')} dist={l.d}/>;})}
                  {!sel.info.levee.length&&<div style={{fontSize:12,color:'var(--text3)'}}>None within 2,625ft</div>}
                </DetailBox>
                <DetailBox title={sel.info.faa.length?'Airports ('+sel.info.faa.length+')':'Airports \u2014 Clear'} color="#06b6d4">
                  {sel.info.faa.map(function(a,i){return <NearbyRow key={i} label={a.n} dist={a.dist}/>;})}
                  {!sel.info.faa.length&&<div style={{fontSize:12,color:'var(--text3)'}}>None within 10,000ft</div>}
                </DetailBox>
              </>:<>
                <div style={S.slabel}>Permits</div>
                {sel.pm&&sel.pm.length>0?sel.pm.map(function(p,i){return <PermitCard key={i} p={p}/>;}):
                <div style={{fontSize:13,color:'var(--text3)',textAlign:'center',padding:16}}>No permits flagged</div>}
              </>
            ):pts.length>0&&Object.keys(res).length>0?(
              <div style={{color:'var(--text3)',fontSize:13,textAlign:'center',padding:16}}>Select a location to view details</div>
            ):pts.length>0?(
              <div style={{color:'var(--text3)',fontSize:13,textAlign:'center',padding:16}}>Click <b>Analyze</b> to check locations</div>
            ):null}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
