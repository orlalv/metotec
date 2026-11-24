var config = [];
var averages_check_flag = [];

$(document).ready(function($) {
    "use strict";

    var mapId = "ts-map-hero";

    //==================================================================================================================
    // VARIABLES
    // =================================================================================================================

    var newMarkers = [];
    var loadedMarkersData = false;
    var loadedMarkersData_h = false;
    var allMarkersData;
    var lastMarker;
    var map;
    var markerCluster;
    var instantaneaQ,instantaneaQ_TA,instantaneaQ_PP;
    var indexClickPrev;
    var nulo_y_90_porciento_ban;
    var yesterday_date, anteayer_date, today_date, today_datetime_24, current_month,current_year,current_month_year;
    var json_name;
    indexClickPrev = null;

    if ($("#" + mapId).length) {

        //==============================================================================================================
        // MAP SETTINGS
        // =============================================================================================================
        var mapElement = $(document.getElementById(mapId));
        var mapDefaultZoom = parseInt(mapElement.attr("data-ts-map-zoom"), 10);
        var centerLatitude = mapElement.attr("data-ts-map-center-latitude");
        var centerLongitude = mapElement.attr("data-ts-map-center-longitude");
        var locale = mapElement.attr("data-ts-locale");
        var currency = mapElement.attr("data-ts-currency");
        var unit = mapElement.attr("data-ts-unit-TA");
        var controls = parseInt(mapElement.attr("data-ts-map-controls"), 10);
        var scrollWheel = parseInt(mapElement.attr("data-ts-map-scroll-wheel"), 10);
        var leafletMapProvider = mapElement.attr("data-ts-map-leaflet-provider");
        var leafletAttribution = mapElement.attr("data-ts-map-leaflet-attribution");
        var zoomPosition = mapElement.attr("data-ts-map-zoom-position");
        var mapBoxAccessToken = '?access_token=' + mapElement.attr("data-ts-map-mapbox-access-token");
        var mapBoxId = mapElement.attr("data-ts-map-mapbox-id");


        if (mapElement.attr("data-ts-map-instantanea-name")) {

            var instantanea  = mapElement.attr("data-ts-map-instantanea").trim();
            var instantaneaName = mapElement.attr("data-ts-map-instantanea-name").trim();
            var instantaneaUnit = mapElement.attr("data-ts-map-instantanea-unit").trim();
            var stack_source = instantanea.split('-')[2];
            var stack_operator = instantanea.split('-')[1];

            var args = instantanea.split('-');
            instantanea = instantanea.split('-')[0] + '-' +instantanea.split('-')[1];
        }

        if (mapElement.attr("data-ts-display-additional-vars")) {
            var displayAdditionalVarsTemp = mapElement.attr("data-ts-display-additional-vars").split(";");
            var displayAdditionalVars = [];
            for (var i = 0; i < displayAdditionalVarsTemp.length; i++) {
                displayAdditionalVars.push(displayAdditionalVarsTemp[i].split("_"));
            }
        }

        // Default map zoom
        if (!mapDefaultZoom) {
            mapDefaultZoom = 14;
        }

        /*old relieve
        var relieve  = L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png', {
            attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a> &mdash; Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }),*/

        var relieve  = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Kartendaten: &copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, <a href="https://viewfinderpanoramas.org">SRTM</a> | Kartendarstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
        }),
        satelite  = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }),
        normal  = L.tileLayer(leafletMapProvider, {
            id: 'mapbox.outdoors',
            attribution: leafletAttribution
        });

        //==================================================================================================================
        var OTRA = L.layerGroup(),
            CEAZA  = L.layerGroup(),
            DMC = L.layerGroup(),
            INIA = L.layerGroup();

        var OTRA = L.layerGroup(),
            CEAZA  = L.layerGroup(),
            DMC = L.layerGroup(),
            INIA = L.layerGroup();

        //L.marker([-40, -73]).bindPopup('jorge, Osorno').addTo(LOS_LAGOS);

        var baseLayers = {
            "Normal": normal,
            "Relieve": relieve,
            "Satélite": satelite
        };

        var overlayMaps = {
            "OTRA": OTRA,
            "CEAZA": CEAZA,
            "DMC": DMC,
            "INIA": INIA
        };


        //==================================================================================================================
        // MAP ELEMENT
        // =================================================================================================================
        map = L.map(mapId, {
            zoomControl: false,
            scrollWheelZoom: scrollWheel,
            layers: [normal, INIA, CEAZA, DMC, OTRA]
        });

        if(localStorage.getItem("latitud")){
            map.setView([localStorage.getItem("latitud"), localStorage.getItem("longitud")], localStorage.getItem("zoom"));
        }
        else{
            map.setView([centerLatitude, centerLongitude], mapDefaultZoom);
        }


        if( controls !== 0 && zoomPosition ){
            L.control.zoom({position: zoomPosition}).addTo(map);
        }
        else if ( controls !== 0 ){
            L.control.zoom({position: "topright"}).addTo(map);
        }

        var layerControl = false;

        $.when(geoRegionesLimites).done(function() {

            var regionesLimites = L.geoJson(geoRegionesLimites.responseJSON, {
                style: styleRegion
            });

            var capas = {
                'estaciones INIA': INIA,
                'estaciones CEAZA': CEAZA,
                'estaciones DMC': DMC,
                'otras instituciones': OTRA
            };

            layerControl = L.control.layers(baseLayers, capas).addTo(map);
            if(geoRegionesLimites){
                layerControl.addOverlay(regionesLimites, "Límite Regional");
            }
            $(".loading-map").hide();

            /*FUNCIONES*/
            function styleRegion(feature) {return {weight: 5,opacity: 1,color: 'blue',dashArray: '3'};}
        });

        $.when(geoComunas).done(function() {
            if(geoComunas){
                var comunasPoligonos = L.geoJson(geoComunas.responseJSON, {
                    style: styleComuna,
                    onEachFeature: onEachFeature,
                    tap: true
                });

                layerControl.addOverlay(comunasPoligonos, "Comunas");

                /*EXTRA CONTROL*/
                var info = L.control({position: 'topright'});
                info.onAdd = function (map) {
                    this._div = L.DomUtil.create('div', 'info');
                    this.reset();
                    return this._div;
                };
                info.update = function (props) {
                    this._div.innerHTML = (props ?
                        '<b>' + props.B + '</b><br />' + props.A + ''
                        : 'Colocar mouse sobre mapa');
                };
                info.reset = function (props) {
                    this._div.innerHTML = '';
                };
                info.addTo(map);
            }

            /*FUNCIONES*/
            function styleComuna(feature) {return {weight: 3,opacity: 1,color: 'gray',dashArray: '3'};}
            function onEachFeature(feature, layer) {
                layer.on({
                    mouseover: highlightFeature,
                    click: highlightFeature,
                    mouseout: resetHighlight,
                    mousedown: zoomToFeature
                });
            }
            function resetHighlight(e) {
                comunasPoligonos.resetStyle(e.target);
                info.reset();
            }

            function zoomToFeature(e) {
                map.fitBounds(e.target.getBounds());
            }
            function highlightFeature(e) {
                /*resetHighlight(e)*/

                var layer = e.target;

                layer.setStyle({
                    weight: 5,
                    color: '#666',
                    dashArray: '',
                    fillOpacity: 0.7
                });

                if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                    layer.bringToFront();
                }

                info.update(layer.feature.properties);
            }

        });

        //==================================================================================================================
        // LOAD DATA
        // =================================================================================================================

        loadData();
    }

    function loadData(parameters) {
        var tmp = mapElement.attr("data-ts-map-tmp");

        if( instantanea !== undefined){

            json_name = instantanea.split('-')[0].toLowerCase();
        }
        else{
            json_name = 'resumen';
        }

        var extra_file = '';

        if (args !== undefined){
            if (args[2] === undefined){
                args[2] = 'HORA';
            }

            switch(args[0]){
                case 'TA':
                    switch(args[2]){
                        case 'DIARIO':
                            extra_file = 'json/' + tmp + '/historicos/ta/days.json';
                        break;

                        case 'HORA':
                            extra_file = 'json/' + tmp + '/historicos/ta/hours.json';
                        break;
                    }
                break;

                default:
                    /*to do*/
            }

            if (extra_file){
                var flag_a = false;

                var a = $.ajax({
                    url: extra_file,
                    dataType: "json",
                    method: "GET",
                    cache: false,
                    success: function (results) {
                        loadedMarkersData_h = results;
                    },
                    error: function (e) {
                        //console.log(e);
                        console.log('no extra file');
                        flag_a = true;
                    }
                });

            }

        }

        var b = $.ajax({
            url: "json/" + tmp + "/items-" + json_name + ".json",
            /*url: "json/' + tmp + '/items_"+ instantanea.split('-')[0] +".json",*/
            dataType: "json",
            method: "GET",
            cache: false,
            success: function (results) {

                if (typeof parameters !== "undefined" && parameters["formData"]) {
                    //loadFormData(parameters);
                }
                else {
                    allMarkersData = results;
                    loadedMarkersData = allMarkersData;

                    today_date          = loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['actual_fecha'];
                    today_datetime_24   = loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['actual_fecha_hora_24'];
                    current_month       = loadedMarkersData[loadedMarkersData.length-1]['setup']['mes']['actual'];
                    current_year        = loadedMarkersData[loadedMarkersData.length-1]['setup']['ano']['actual'];

                    yesterday_date      = loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['ayer'];
                    anteayer_date       = loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['anteayer'];
                    if (!anteayer_date && today_date) {
                        var d = new Date(today_date + 'T00:00:00');
                        d.setDate(d.getDate() - 2);
                        anteayer_date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
                    }

                    current_month_year  = current_year+'-'+current_month+'-01';

                    //console.log(stack_source)
                    if(instantanea !== undefined){
                        switch (instantanea){
                            case 'TA-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['TA'];
                                break;
                            case 'TA-MIN':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['TA_DIA_MIN'];
                                $("#percentil_title").html( $("#percentil_title").html() + ' - Hoy') ;
                                break;
                            case 'TA-MAX':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['TA_DIA_MAX'];
                                $("#percentil_title").html( $("#percentil_title").html() + ' - Ayer') ;
                                break;
                            case 'TS00-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['TS00'];
                                break;
                             case 'TS10-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['TS10'];
                                break;
                             case 'HR-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['HR'];
                                break;
                             case 'PS-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PS'];
                                break;
                             case 'RD-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['RD'];
                                break;
                             case 'PP-SUM':
                                switch(stack_source){
                                    case 'ANUAL':
                                        instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_ANUAL'];
                                        break;

                                    case 'DIARIO':
                                        instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_SUM_DIA'];
                                        break;

                                    case '24':
                                        instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_SUM_24'];
                                        break;

                                    case 'AYER':
                                        instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_SUM_AYER']
                                            || loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_SUM_DIA'];
                                        break;

                                    case 'ANTEAYER':
                                        instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_SUM_ANTEAYER']
                                            || loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP_SUM_DIA'];
                                        break;

                                    default:
                                        instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP'];
                                }
                                break;
                             case 'VV-AVG':
                                instantaneaQ  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['VV'];
                                break;
                        }

                        $("#div_q_1").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q1']).toFixed(1) : Math.round(instantaneaQ['q1'])  : parseFloat(instantaneaQ['q1']).toFixed(1) );
                        $("#div_q_2").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q2']).toFixed(1) : Math.round(instantaneaQ['q2'])  : parseFloat(instantaneaQ['q2']).toFixed(1) );
                        $("#div_q_3").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q3']).toFixed(1) : Math.round(instantaneaQ['q3'])  : parseFloat(instantaneaQ['q3']).toFixed(1) );
                        $("#div_q_4").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q4']).toFixed(1) : Math.round(instantaneaQ['q4'])  : parseFloat(instantaneaQ['q4']).toFixed(1) );
                        $("#div_q_5").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q5']).toFixed(1) : Math.round(instantaneaQ['q5'])  : parseFloat(instantaneaQ['q5']).toFixed(1) );
                        $("#div_q_6").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q6']).toFixed(1) : Math.round(instantaneaQ['q6'])  : parseFloat(instantaneaQ['q6']).toFixed(1) );
                        $("#div_q_7").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q7']).toFixed(1) : Math.round(instantaneaQ['q7'])  : parseFloat(instantaneaQ['q7']).toFixed(1) );
                        $("#div_q_8").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q8']).toFixed(1) : Math.round(instantaneaQ['q8'])  : parseFloat(instantaneaQ['q8']).toFixed(1) );
                        $("#div_q_9").html( instantanea == 'PP-SUM' ? stack_source != 'ANUAL' ? parseFloat(instantaneaQ['q9']).toFixed(1) : Math.round(instantaneaQ['q9'])  : parseFloat(instantaneaQ['q9']).toFixed(1) );

                    }
                    else{
                        instantaneaQ_TA  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['TA'];
                        instantaneaQ_PP  = loadedMarkersData[loadedMarkersData.length-1]['setup']['Q']['PP'];

                    }

                }


            },
            error: function (e) {
                console.log(e);
            }
        });


        $.when(a, b).done(function() {
            if (extra_file){
                if ( (loadedMarkersData.length-1) != loadedMarkersData_h.length){
                    console.log('diferente # de estaciones : histórico '+ loadedMarkersData_h.length +' vs actual ' +(loadedMarkersData.length-1) )

                    loadedMarkersData_h = false;
                }
            }

            createMarkers(); // call function to create markers
        });
    }

    /***/
    if(!sessionStorage.latitud){

        var targetNode = document.getElementById('geotext');
        var set = { attributes: true, childList: true };

        var callback = function(mutationsList) {
            for(var mutation of mutationsList) {
                if(sessionStorage.latitud){
                    map.setView([sessionStorage.latitud, sessionStorage.longitud], 10);
                    observer.disconnect();
                }
            }
        };
        var observer = new MutationObserver(callback);
        observer.observe(targetNode, set);
    }
    /****** */

    $(document).on("click", "#regiones a", function () {

        var zoom = parseInt($(this).attr("data-ts-map-zoom"), 10);
        var latitude = $(this).attr("data-ts-map-center-latitude");
        var longitude = $(this).attr("data-ts-map-center-longitude");

        map.setView([latitude, longitude], zoom);

        localStorage.setItem("latitud", latitude);
        localStorage.setItem("longitud", longitude);
        localStorage.setItem("zoom", zoom);
    });

    //==================================================================================================================
    // Create DIV with the markers data
    // =================================================================================================================
    function createMarkers() {

        /*markerCluster = L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 1
        });*/

        //console.log(loadedMarkersData.length)
        for (var i = 0; i < loadedMarkersData.length-1; i++) {

            var markerContent = document.createElement('div');

            markerContent.innerHTML = markerContentInstantanea(loadedMarkersData[i], i);

            placeLeafletMarker({"i": i, "markerContent": markerContent, "method": "latitudeLongitude"});

        }

        // After the markers are created, do the rest

        markersDone();
    }

    function nulo_y_90_porciento(item, index, arr){

        if (item.valor == null && index < current_month){
            nulo_y_90_porciento_ban = false;
        }

    }

    function format_date(d){
        var formatted_date;
        var elemento = d.split('-');

        formatted_date = elemento[2] + ' de ' + MES[elemento[1] -1] + ' del ' + elemento[0];

        return formatted_date;
    }

    function format_datetime(d){
        var formatted_date;
        var elemento = d.split(' '), fecha = elemento[0].split('-'), hora = elemento[1].split(':');

        formatted_date = hora[0] + ':00 del ' + fecha[2] + ' de ' + MES[fecha[1]-1];

        return formatted_date + ' <sup>UTC-4</sup>';

    }


    function markerContentInstantanea(data , i){

        //console.log('marker de '+data["nombre"]+':' +i)
        //console.log('insta '+data["nombre"]+':' +instantanea)
        if(instantanea !== undefined ){

            var current = 's/i', last, acum, ban = false;

            if((instantanea.indexOf("PP") > -1) && stack_source !== undefined ){

                if (stack_source == 'ANUAL'){

                    switch(instantanea){
                        case 'PP-SUM':
                            if(data['STACK-YEAR']!== undefined ){
                                if(data['STACK-YEAR']['PP-SUM'] !== undefined ){
                                    for (last in data['STACK-YEAR']['PP-SUM']);

                                    if(data['STACK-YEAR']['PP-SUM'][last]!==undefined && data['STACK-YEAR']['PP-SUM'][last]!==null && data['STACK-MONTH'] !== undefined ){
                                        nulo_y_90_porciento_ban = true;

                                        Object.values(data['STACK-MONTH']['PP-SUM']).forEach(nulo_y_90_porciento);

                                        if (nulo_y_90_porciento_ban){
                                            current = data['STACK-YEAR']['PP-SUM'][last];
                                            var formatted_date = last;
                                        }
                                    }
                                }
                            }
                            break;
                    }

                }
                else if(stack_source == 'DIARIO'){

                    switch(instantanea){
                        case 'PP-SUM':
                            if(data['STACK-DAY']['hoy'] !== undefined ){
                                if(data['STACK-DAY']['hoy']['PP-SUM'] !== undefined ){

                                    if(data['STACK-DAY']['hoy']['PP-SUM'] !== null){
                                        current = data['STACK-DAY']['hoy']['PP-SUM'];

                                        formatted_date = format_date(today_date);
                                    }
                                }
                            }
                            break;
                    }

                }
                else if(stack_source == 'AYER'){

                    switch(instantanea){
                        case 'PP-SUM':
                            if(data['STACK-DAY']['ayer'] !== undefined ){
                                if(data['STACK-DAY']['ayer']['PP-SUM'] !== undefined ){

                                    if(data['STACK-DAY']['ayer']['PP-SUM'] !== null){
                                        current = data['STACK-DAY']['ayer']['PP-SUM'];

                                        formatted_date = format_date(yesterday_date);
                                    }
                                }
                            }
                            break;
                    }

                }
                else if(stack_source == 'ANTEAYER'){

                    switch(instantanea){
                        case 'PP-SUM':
                            var anteayerStack = (data['STACK-DAY']['anteayer'] !== undefined)
                                ? data['STACK-DAY']['anteayer']
                                : (anteayer_date && data['STACK-DAY'][anteayer_date] !== undefined ? data['STACK-DAY'][anteayer_date] : undefined);

                            if(anteayerStack !== undefined ){
                                if(anteayerStack['PP-SUM'] !== undefined ){

                                    if(anteayerStack['PP-SUM'] !== null){
                                        current = anteayerStack['PP-SUM'];

                                        formatted_date = format_date(anteayer_date);
                                    }
                                }
                            }
                            break;
                    }

                }
                else if(stack_source == '24'){

                    switch(instantanea){
                        case 'PP-SUM':
                            if(data['STACK-HOUR'] !== undefined ){
                                if(data['STACK-HOUR'] !== undefined){
                                    console.log(today_datetime_24)
                                    for (last in data['STACK-HOUR']) {

                                        if ( data['STACK-HOUR'][last]['PP-SUM'] != null ){
                                            ban = true;
                                        }

                                        if(last == today_datetime_24){
                                            acum = 0;
                                        }

                                        acum = (acum!==undefined ? acum : 0) + eval(data['STACK-HOUR'][last]['PP-SUM'])

                                        /*if ( eval(i) == 267 ){
                                            console.log('marker de '+data["nombre"]+':' +i + ' : ' + last + ' : ' + data['STACK-HOUR'][last]['PP-SUM'] )
                                        }*/


                                    }

                                    if(ban){
                                        current = acum.toFixed(1);
                                        formatted_date = format_date(yesterday_date) + ' al ' +format_date(today_date);
                                    }

                                }
                            }
                            break;
                    }

                }
            }
            else if((instantanea.indexOf("TA") > -1) && stack_source !== undefined ){
                if (stack_source == 'DIARIO'){
                    switch(stack_operator){
                        case 'MIN':
                            if(data['STACK-DAY']['hoy'] !== undefined ){
                                if(data['STACK-DAY']['hoy']['TA-MIN'] !== undefined ){

                                    if(data['STACK-DAY']['hoy']['TA-MIN'] !== null){
                                        current = data['STACK-DAY']['hoy']['TA-MIN'];

                                        formatted_date = format_date(today_date);
                                    }

                                }
                            }
                            break;

                        case 'MAX':
                            if(data['STACK-DAY']['ayer'] !== undefined ){
                                if(data['STACK-DAY']['ayer']['TA-MAX'] !== undefined ){

                                    if(data['STACK-DAY']['ayer']['TA-MAX'] !== null){
                                        current = data['STACK-DAY']['ayer']['TA-MAX'];

                                        formatted_date = format_date(yesterday_date);
                                    }

                                }
                            }
                            break;
                    }
                }
            }
            else if((instantanea.indexOf("VV") > -1) && stack_source !== undefined ){
                if (stack_source == 'DIA'){
                    if(data['STACK-DAY']['hoy'] !== undefined ){
                        if(data['STACK-DAY']['hoy']['VV-AVG'] !== undefined ){

                            if(data['STACK-DAY']['hoy']['VV-AVG'] !== null){
                                current = data['STACK-DAY']['hoy']['VV-AVG'];

                                formatted_date = format_date(today_date);
                            }

                        }
                    }
                }
                else if (stack_source == 'AYER'){
                    if(data['STACK-DAY']['ayer'] !== undefined ){
                        if(data['STACK-DAY']['ayer']['VV-AVG'] !== undefined ){

                            if(data['STACK-DAY']['ayer']['VV-AVG'] !== null){
                                current = data['STACK-DAY']['ayer']['VV-AVG'];

                                formatted_date = format_date(yesterday_date);
                            }

                        }
                    }
                }
                else if (stack_source == 'MES'){
                    if(data['STACK-MONTH'] !== undefined ){
                        if(data['STACK-MONTH']['VV-AVG'] !== undefined ){
                            if(data['STACK-MONTH']['VV-AVG'][[current_month_year]] !== undefined ){

                                if(data['STACK-MONTH']['VV-AVG'][current_month_year]['valor'] !== null){
                                    current = data['STACK-MONTH']['VV-AVG'][current_month_year]['valor'];

                                    var formatted_date =  MES[current_month-1] + ' del '+current_year;
                                    formatted_date = formatted_date;
                                }

                            }
                        }
                    }
                }
            }
            else{

                if( data['STACK-HOUR'] !== undefined ){

                    /* solo muestro la instantanea dentro de las ultimas 3 horas */
                    for (last in data['STACK-HOUR']);
                    if(data['STACK-HOUR'][last][instantanea]==undefined){
                        delete data['STACK-HOUR'][last];
                        for (last in data['STACK-HOUR']);
                            if(data['STACK-HOUR'][last][instantanea]==undefined){
                                delete data['STACK-HOUR'][last];
                                for (last in data['STACK-HOUR']);
                                    if(data['STACK-HOUR'][last][instantanea]==undefined){
                                        delete data['STACK-HOUR'][last];
                                        for (last in data['STACK-HOUR']);
                                    }
                            }
                    }
                    //console.log('other: ' +last)
                    /* end solo muestro la instantanea dentro de las ultimas 3 horas */

                    if(data['STACK-HOUR'][last][instantanea]!==undefined && data['STACK-HOUR'][last][instantanea]!==null){
                        current = data['STACK-HOUR'][last][instantanea];

                        formatted_date = format_datetime(last);
                        formatted_date = formatted_date;
                    }

                }

            }

            return '<div class="ts-marker-wrapper">' +
                        '<a href="#" class="ts-marker" data-ts-index="' + i + '" data-ts-id="' + i + '" data-ts-ln="' + i + '">' +

                            ( ( data["dias_activa"] <= 182 ) ? '<div class="ts-marker__feature"><i class="fa fa-plus"></i></div>' : "" ) +

                            '<div class="circle small '+ (instantanea.indexOf("PP") ? colorQuintil_A(current) : colorQuintil_B(current) ) +'">' +
                                ' <div>'+ current +'</div>' +
                            '</div>' +

                                ( ( data["nombre"] !== undefined ) ? '<div class="ts-marker__info">' + data["nombre"] + ', '+ data["comuna"] +' <sup>'+ data["institucion_sigla"] +'</sup></div>' : "" ) +
                                ( ( formatted_date !== undefined ) ? '<div class="ts-marker__title">' + formatted_date + '</div>' : "" ) +

                        '</a>' +
                    '</div>';

            /*return '<div class="ts-marker-wrapper">' +
                    '<a href="#" class="ts-marker" data-ts-id="' + data["id"] + '" data-ts-ln="' + i + '">' +
                    ( ( data["ribbon"] !== undefined ) ? '<div class="ts-marker__feature"><i class="fa fa-plus"></i></div>' : "" ) +
                    ( ( data["nombre"] !== undefined ) ? '<div class="ts-marker__title">' + data["nombre"] + '</div>' : "" ) +
                    ( ( data["comuna"] !== undefined ) ? '<div class="ts-marker__info">' + data["comuna"] + '</div>' : "" ) +
                    '<div class="ts-marker__image ts-black-gradient" style="background-color: '+ colorQuintil(data[instantanea]) +' ; color: white; font-weight:bold; text-align:center; padding: 10px 0"> ' + data[instantanea] + '</div>' +
                    '</a>' +
                '</div>';*/
        }
        else{
            return '<div class="ts-marker-wrapper">' +
                        '<a href="#" class="ts-marker" data-ts-index="' + i + '" data-ts-id="' + i + '" data-ts-ln="' + i + '">' +

                            ( ( data["dias_activa"] <= 182 ) ? '<div class="ts-marker__feature"><i class="fa fa-plus"></i></div>' : "" ) +

                            '<div class="circle small '+ ((data["status"] == 1) ? 'online' : 'offline') +'"> <div></div></div>' +

                                ( ( data["nombre"] !== undefined ) ? '<div class="ts-marker__info">' + data["nombre"] + ' <sup>'+ data["institucion_sigla"] +'</sup></div>' : "" ) +
                                ( ( data["comuna"] !== undefined ) ? '<div class="ts-marker__title">' + data["comuna"] + '</div>' : "" ) +

                        '</a>' +
                    '</div>';

            /*return '<div class="ts-marker-wrapper">' +
                    '<a href="#" class="ts-marker" data-ts-id="' + data["id"] + '" data-ts-ln="' + i + '">' +
                    ( ( data["ribbon"] !== undefined ) ? '<div class="ts-marker__feature"><i class="fa fa-plus"></i></div>' : "" ) +
                    ( ( data["nombre"] !== undefined ) ? '<div class="ts-marker__title">' + data["nombre"] + '</div>' : "" ) +
                    ( ( data["comuna"] !== undefined ) ? '<div class="ts-marker__info">' + data["comuna"] + '</div>' : "" ) +
                    ( ( data["marker_image"] !== undefined ) ? '<div class="ts-marker__image ts-black-gradient" style="background-image: url(' + data["marker_image"] + ')"><div class="'+ (data["status"] == 1 ? 'online' : 'offline') +'"></div></div>' : '<div class="ts-marker__image ts-black-gradient" style="background-image: url(assets/img/marker-default-img.png)"></div>' ) +
                    '</a>' +
                '</div>';*/
        }

    }


    function colorQuintil_A(val){
        if(val=='s/i'){
            return 'offline';
        }

        if(val < eval(instantaneaQ['q1'])){
            //console.log(val +  ' : <' + instantaneaQ['q1'] + ' => q1');
            return 'q1';
        }
        else if(val < eval(instantaneaQ['q2'])){
            //console.log(val +  ' :  <' + instantaneaQ['q2'] + ' => q2');
            return 'q2';
        }
        else if(val < eval(instantaneaQ['q3'])){
            //console.log(val +  ' : <' + instantaneaQ['q3'] + ' => q3');
            return 'q3';
        }
        else if(val < eval(instantaneaQ['q4'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q4';
        }
        else if(val < eval(instantaneaQ['q5'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q5';
        }
        else if(val < eval(instantaneaQ['q6'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q6';
        }
        else if(val < eval(instantaneaQ['q7'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q7';
        }
        else if(val < eval(instantaneaQ['q8'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q8';
        }
        else if(val < eval(instantaneaQ['q9'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q9';
        }
        else{
            //console.log(val +  ' : >' + instantaneaQ['q4'] + ' => q5');
            return 'q10';
        }
    }

    function colorQuintil_B(val){
        if(val=='s/i'){
            return 'offline';
        }

        if(val < eval(instantaneaQ['q1'])){
            //console.log(val +  ' : <' + instantaneaQ['q1'] + ' => q1');
            return 'q10';
        }
        else if(val < eval(instantaneaQ['q2'])){
            //console.log(val +  ' :  <' + instantaneaQ['q2'] + ' => q2');
            return 'q9';
        }
        else if(val < eval(instantaneaQ['q3'])){
            //console.log(val +  ' : <' + instantaneaQ['q3'] + ' => q3');
            return 'q8';
        }
        else if(val < eval(instantaneaQ['q4'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q7';
        }
        else if(val < eval(instantaneaQ['q5'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q6';
        }
        else if(val < eval(instantaneaQ['q6'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q5';
        }
        else if(val < eval(instantaneaQ['q7'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q4';
        }
        else if(val < eval(instantaneaQ['q8'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q3';
        }
        else if(val < eval(instantaneaQ['q9'])){
            //console.log(val +  ' : <' + instantaneaQ['q4'] + ' => q4');
            return 'q2';
        }
        else{
            //console.log(val +  ' : >' + instantaneaQ['q4'] + ' => q5');
            return 'q1';
        }
    }


    //==================================================================================================================
    // When markers are placed, do the rest
    // =================================================================================================================
    function markersDone() {

        //==================================================================================================================
        // MARKER CLUSTERER
        // =============================================================================================================

        //map.addLayer(markerCluster);

        createSideBarResult('undefined');
        map.on("moveend", function() {
            createSideBarResult('undefinedMoveend');
        });

    }

    function which_layer(layer){
        switch (layer){
            case "INIA":
                return INIA;
                break;

            case "CEAZA":
                return CEAZA;
                break;

            case "DMC":
                return DMC;
                break;

            default:
                return OTRA;
                break;
        }
    }
    //==================================================================================================================
    // Google Rich Marker plugin
    // =================================================================================================================

    function placeLeafletMarker(parameters) {

        var i = parameters["i"];

        var layer = loadedMarkersData[i]["institucion_sigla"];

        // Define marker HTML

        var markerIcon = L.divIcon({
            html: parameters["markerContent"].innerHTML,
            iconSize: [32, 32],
            iconAnchor: [16, 32] /* [margen left negative, margin top negative]*/
        });

        //console.log(layer)

        // Attach marker to map
        if (layer !== undefined){
            /*var marker = L.circleMarker([loadedMarkersData[i]["latitude"], loadedMarkersData[i]["longitude"]], {
                radius: 8.0,
                fillColor: '#11fe00',
                color: '#000000',
                weight: 1,
                opacity: 1.0,
                fillOpacity: 0.8
            }).addTo( which_layer(loadedMarkersData[i]["layer"]) );*/

            var marker = L.marker([loadedMarkersData[i]["latitud"], loadedMarkersData[i]["longitud"]], {
                icon: markerIcon
            }).addTo( which_layer(layer) );
        }
        else{
            var marker = L.marker([loadedMarkersData[i]["latitud"], loadedMarkersData[i]["longitud"]], {
                icon: markerIcon
            });
        }

        marker.loopNumber = i;

        //markerCluster.addLayer(marker);

        // Open Popup on click
        if (instantanea === undefined){

            marker.on('click', function () {
                if (lastMarker && lastMarker._icon) {
                    $(lastMarker._icon.firstChild).removeClass("ts-hide-marker");
                }
                openInfobox({
                    "id": $(this._icon).find(".ts-marker").attr("data-ts-id"),
                    "parentMarker": marker,
                    "i": i,
                    /*"url": "assets/db/items-resumen.json"*/
                    "url": "assets/db/items-" + json_name + ".json"
                });

                createSideBarResult($(this._icon).find(".ts-marker").attr("data-ts-index"));
            });

        }
        else{
            marker.on('click', function () {
                createSideBarResult($(this._icon).find(".ts-marker").attr("data-ts-index"));
            });
        }

        newMarkers.push(marker);
    }


    //==================================================================================================================
    // Open InfoBox on marker click
    // =================================================================================================================
    function openInfobox(parameters) {


        var i = parameters["i"];
        var parentMarker = parameters["parentMarker"];
        var id = parameters["id"];
        var infoboxHtml = document.createElement('div');

        // First create and HTML for infobox
        createInfoBoxHTML({"i": i, "infoboxHtml": infoboxHtml});

        //==============================================================================================================
        // Set InfoBox options
        //==============================================================================================================
        /*map.setView( [parentMarker._latlng.lat, parentMarker._latlng.lng]);*/

        var popup = L.popup({closeButton: false, offset: [210, -10], closeOnClick: true, minWidth: 420, autoPanPadding: [120, 60] })
            .setLatLng([parentMarker._latlng.lat, parentMarker._latlng.lng])
            .setContent(infoboxHtml)
            .openOn(map);

        // Set the new "Last" opened marker
        lastMarker = parentMarker;

        // Hide the current marker, so only InfoBox is visible
        parentMarker._markerIcon = parentMarker._icon.firstChild;
        $(parentMarker._icon.firstChild).addClass("ts-hide-marker");

        setTimeout(function () {
            $(".ts-infobox[data-ts-id='" + i + "']").closest(".infobox-wrapper").addClass("ts-show");

            $(".ts-infobox[data-ts-id='" + i + "'] .ts-close").on("click", function () {
                $(".ts-infobox[data-ts-id='" + i + "']").closest(".infobox-wrapper").removeClass("ts-show");
                $(parentMarker._markerIcon).removeClass("ts-hide-marker");
                map.closePopup();
            });
        }, 50);

    }

    //==================================================================================================================
    // Create Infobox HTML element
    //==================================================================================================================

    function createInfoBoxHTML(parameters) {

        var i = parameters["i"];
        var infoboxHtml = parameters["infoboxHtml"];

        infoboxHtml.innerHTML =
            '<div class="infobox-wrapper">' +
                '<div class="ts-infobox" data-ts-index="' + i + '" data-ts-id="' + i + '">' +
                    '<img src="assets/img/infobox-close.svg" class="ts-close">' +

                    ( ( loadedMarkersData[i]["dias_activa"] <= 182 ) ? '<div class="ts-ribbon-corner"><span>nueva</span></div>' : "" ) +

                    '<a href="#" class="ts-infobox__wrapper ts-black-gradient">' +

                        ((loadedMarkersData[i]["dias_activa"] > 182) ? ( ( loadedMarkersData[i]["status"] !== undefined && loadedMarkersData[i]["status"] == 1) ? '<div class="badge badge-success">' + loadedMarkersData[i]["status_name"] + '</div>' : '<div class="badge badge-danger">' + loadedMarkersData[i]["status_name"] + '</div>' ) : '') +

                        '<div class="ts-infobox__content">' +
                            '<figure class="ts-item__info">' +
                                /*( ( loadedMarkersData[i]["institucion_sigla"] !== undefined ) ? '<div class="ts-item__info-badge">' + loadedMarkersData[i]["institucion_sigla"] + '</div>' : "" ) +*/
                                ( ( loadedMarkersData[i]["nombre"] !== undefined ) ? '<h4>' + loadedMarkersData[i]["nombre"] + ', '  + loadedMarkersData[i]["comuna"] +  '</h4>' : "" ) +
                                '<aside>'+
                                    '<i class="fas fa-map-marker-alt mr-2"></i>latitud '+ String(loadedMarkersData[i]["latitud"]).substr(0,6) + ', longitud '+ String(loadedMarkersData[i]["longitud"]).substr(0,6) + ',  elevación '+loadedMarkersData[i]["elevacion"]+ ' msnm.'+
                                '</aside>'+

                            '</figure>' +

                            additionalInfoHTML({display: displayAdditionalVars, i: i}) +

                        '</div>' +
                        '<div class="ts-infobox_image" style="background: #666"></div>' +
                    '</a>' +
                '</div>' +
            '</div>';
    }

    //==================================================================================================================
    // Create Additional Info HTML element
    //==================================================================================================================

    function additionalInfoHTML(parameters) {
        var i = parameters["i"];
        var displayParameter;

        var additionalInfoHtml = "";
        for (var a = 0; a < parameters["display"].length; a++) {

            displayParameter = parameters["display"][a];

            if(displayParameter[0]=='NIEVE-MAX' && loadedMarkersData[i]['STACK-DAY']['hoy'][displayParameter[0]] == null)continue;


            if (loadedMarkersData[i]['STACK-DAY'] !== undefined) {
                var ban = displayParameter[2] == 'grados'? true: false;

                additionalInfoHtml +=
                    '<dl>' +
                        '<dt>' + displayParameter[1] +
                            ((displayParameter[2]!=='') ? ' <small>( ' + displayParameter[2]  +' )</small>':'' ) +
                        '</dt>' +

                        '<dd>' + (loadedMarkersData[i]['STACK-DAY']['ayer']!== undefined?(ban?loadedMarkersData[i]['STACK-DAY']['ayer'][displayParameter[0]]+' '+cardinal(loadedMarkersData[i]['STACK-DAY']['ayer'][displayParameter[0]]): (loadedMarkersData[i]['STACK-DAY']['ayer'][displayParameter[0]] !== null) ? loadedMarkersData[i]['STACK-DAY']['ayer'][displayParameter[0]] : 's/i' ):'s/i') + '</small></dd>' +

                        '<dd class="hoy">' + (loadedMarkersData[i]['STACK-DAY']['hoy']!== undefined?(ban?loadedMarkersData[i]['STACK-DAY']['hoy'][displayParameter[0]]+' '+cardinal(loadedMarkersData[i]['STACK-DAY']['hoy'][displayParameter[0]]):  (loadedMarkersData[i]['STACK-DAY']['hoy'][displayParameter[0]] !== null ? loadedMarkersData[i]['STACK-DAY']['hoy'][displayParameter[0]] : 's/i' ) ) :'s/i') + '</dd>' +

                        '<dd>' + (loadedMarkersData[i]['STACK-DAY']['manana']!== undefined?(typeof(loadedMarkersData[i]['STACK-DAY']['manana'][displayParameter[0]]) === 'string' ? (ban?loadedMarkersData[i]['STACK-DAY']['manana'][displayParameter[0]]+' '+cardinal(loadedMarkersData[i]['STACK-DAY']['manana'][displayParameter[0]]):loadedMarkersData[i]['STACK-DAY']['manana'][displayParameter[0]]):'s/i'):'s/i') + '</dd>' +
                        '<dd>' + (loadedMarkersData[i]['STACK-DAY']['pasado']!== undefined?(typeof(loadedMarkersData[i]['STACK-DAY']['pasado'][displayParameter[0]]) === 'string' ? (ban?loadedMarkersData[i]['STACK-DAY']['pasado'][displayParameter[0]]+' '+cardinal(loadedMarkersData[i]['STACK-DAY']['pasado'][displayParameter[0]]):loadedMarkersData[i]['STACK-DAY']['pasado'][displayParameter[0]]):'s/i'):'s/i') + '</dd>' +

                    '</dl>';
            }
        }

        if (additionalInfoHtml) {
            if(loadedMarkersData[i]['institucion_sigla']=='INIA'){
                return '<div class="ts-description-lists">' +
                        /*'<dl><dt>RESUMEN DIARIO</dt></dl>'+*/
                        '<dl style="/*display: flex;align-items: center;padding: 4px*/"><dt>&nbsp;</dt><dd>Ayer</dd><dd class="hoy"> Actual &nbsp;&nbsp;<small>00 a '+ loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['actual'] +' <sup>hrs.</sup></small></sup></dd><dd>'+ loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['manana'] +'</dd><dd>'+ loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['pasado'] +'</dd></dl>'+

                        additionalInfoHtml + '</div>' +
                    '<div class="ts-description-lists center"> '+
                        '<span>Propiedad de '+ loadedMarkersData[i]['institucion_nombre'] +' ('+ loadedMarkersData[i]['institucion_sigla'] +'). </span>'+
                        '<br><span>Pronóstico de la Dirección Meteorológica de Chile (DMC) mediante modelo numérico WRF [valor no oficial].</span>'+
                    '</div>';
            }
            else{
                return '<div class="ts-description-lists">' +
                        /*'<dl><dt>RESUMEN DIARIO</dt></dl>'+*/
                        '<dl style="/*display: flex;align-items: center;padding: 4px*/"><dt>&nbsp;</dt><dd>Ayer</dd><dd class="hoy"> Actual &nbsp;&nbsp;<small>00 a '+ loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['actual'] +' <sup>hrs.</sup></small></sup></dd><dd>'+ loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['manana'] +'</dd><dd>'+ loadedMarkersData[loadedMarkersData.length-1]['setup']['dias']['pasado'] +'</dd></dl>'+

                        additionalInfoHtml + '</div>' +
                    '<div class="ts-description-lists center"> '+
                        '<span>Propiedad de '+ loadedMarkersData[i]['institucion_nombre'] +' ('+ loadedMarkersData[i]['institucion_sigla'] +'). </span>'+
                        '<br><span>Pronóstico de la Dirección Meteorológica de Chile (DMC) mediante modelo numérico WRF [valor no oficial].</span>'+
                    '</div>';
            }
        }
        else {
            return "";
        }
    }


    //==================================================================================================================
    // BARRA DE RESULTADOS - ESTACIONES VISIBLES
    //==================================================================================================================
    function createSideBarResult(indexClick) {
        //console.log(indexClick)

        if(indexClick == 'undefinedMoveend' && indexClickPrev != null){
            indexClick = indexClickPrev;
            indexClickPrev = null;
        }
        else{
            if(indexClick == 'undefinedMoveend'){
                indexClick = undefined;
            }
        }


        indexClick = eval(indexClick);

        //console.log('indexClick: '+indexClick+' | typeof: '+typeof(indexClick))

        //var visibleMarkersId = [];
        var visibleMarkersOnMap = [];
        var resultsHtml = [];
        var timeFormat = 'YYYY-MM-DD HH:mm';
        var color = Chart.helpers.color;
        var idx = [];
        var markers_in = [];
        var markers_in_total = 0;

        if( typeof(indexClick) == 'number' ){
            indexClickPrev = indexClick;
            visibleMarkersOnMap.push( newMarkers[indexClick] );
        }
        else{
            /*BUSCO EL CENTRO DE MAPA, COMO? SOLO BUSCO EL MARKER DE LA MITAD*/
            for (var i = 0; i < loadedMarkersData.length-1; i++) {
                if (map.getBounds().contains(newMarkers[i].getLatLng()) && newMarkers[i]._map !== null) {
                    markers_in[markers_in_total] = i;
                    markers_in_total++;
                }
            }
            markers_in_total = Math.round(markers_in_total/2);

            if (markers_in.length > 1 ){
                indexClick = markers_in[markers_in_total];
            }
            else{
                indexClick = markers_in[0];
            }

            visibleMarkersOnMap.push(newMarkers[indexClick]);
        }

        for (var i = 0; i < loadedMarkersData.length-1; i++) {

            if (map.getBounds().contains(newMarkers[i].getLatLng()) && newMarkers[i]._map !== null) {
                //console.log(indexClick + ' != '+ i )
                if( indexClick != i ){

                        let d = distancia(visibleMarkersOnMap[0]._latlng.lat, visibleMarkersOnMap[0]._latlng.lng, newMarkers[i]._latlng.lat, newMarkers[i]._latlng.lng);
                        newMarkers[i].distancia = d;

                        visibleMarkersOnMap.push(newMarkers[i]);

                        //console.log(newMarkers[i])

                }
                else{
                    newMarkers[i].distancia = 0;
                    //console.log(visibleMarkersOnMap[0])

                }

                //newMarkers[i].addTo(map);
            }
            else {
                //newMarkers[i].setVisible(false);
                //newMarkers[i].remove();
            }

        }

        /*ORDEN OBJ*/
        var visibleMarkersOnMapOrder = visibleMarkersOnMap.slice(0);
        visibleMarkersOnMapOrder.sort(function(a,b) {
            return a.distancia - b.distancia;
        });


        /*END ORDEN OBJ*/

        /*DISTANCIA HAVERSINE, INCORPORA CURVATURA DE LA TIERRA*/
        function distancia(lat1, lon1, lat2, lon2) {
          var p = 0.017453292519943295;    // Math.PI / 180
          var c = Math.cos;
          var a = 0.5 - c((lat2 - lat1) * p)/2 +
                  c(lat1 * p) * c(lat2 * p) *
                  (1 - c((lon2 - lon1) * p))/2;

          return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
        }
        /*END DISTANCIA*/

        //no iba - markerCluster.refreshClusters();

        var hh;
        if (visibleMarkersOnMapOrder[0] !== undefined){
            if (visibleMarkersOnMapOrder.length > 30 ){
                visibleMarkersOnMapOrder.length = 30;
            }

            for (i = 0; i < visibleMarkersOnMapOrder.length; i++) {

                var id = visibleMarkersOnMapOrder[i].loopNumber;
                var additionalInfoHtml = "";

                idx.push(id);
                //console.log('instantanea de '+loadedMarkersData[id]["nombre"]+': ' + id)

                if (loadedMarkersData[id]["additional_info"]) {
                    for (var a = 0; a < loadedMarkersData[id]["additional_info"].length; a++) {
                        additionalInfoHtml +=
                            '<dl>' +
                                '<dt>' + loadedMarkersData[id]["additional_info"][a]["nombre"] + '</dt>' +
                                '<dd>' + loadedMarkersData[id]["additional_info"][a]["value"] + '</dd>' +
                            '</dl>';
                    }
                }

                if(instantanea == 'VV-AVG' && stack_source === undefined){
                    hh = 280;
                }
                else{
                    hh = 180;
                }

                resultsHtml.push(
                    '<div class="ts-result-link w-100" data-ts-id="' + id + '" data-ts-ln="' + newMarkers[id].loopNumber + '">' +
                        '<span class="ts-center-marker"><img src="assets/img/result-center.svg"></span>' +

                        '<div class="card ts-item ts-card ts-result">' +
                            ( ( loadedMarkersData[id]["dias_activa"] <= 182 ) ? '<div class="ts-ribbon-corner"><span>nueva</span></div>' : "" ) +

                            '<div class="card-body"'+ ( (loadedMarkersData[id]["dias_activa"] <= 182 ) ? 'style="padding-right:50px !important"': '') +'">' +
                                '<div class="ts-item__info-badge">' + loadedMarkersData[id]["nombre"] + ', ' + loadedMarkersData[id]["comuna"] + ' <sup>'+ loadedMarkersData[id]["institucion_sigla"] +'</sup></div>' +
                                '<div>'+
                                    '<div id="highchart-'+id+'" style="width: 100% !important; height: '+hh+'px !important;position: relative;">' +
                                        '<canvas style="width: 100% !important; height: '+hh+'px !important;" id="canvas-'+id+'"></canvas>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +

                            '<div class="card-footer '+ ((loadedMarkersData[id]["status"]==1)?'online':'offline') +'">' +

                            '</div>' +

                        '</div>' +
                    '</div>'
                );


                /*STACK PARA GRAFICOS ACTUALES*/
                var labels= [];
                var tmax= [];
                var tmin= [];
                var pp= [];

                var insta =[];
                var instaAcum =[];
                var insta_join = [];
                var ta =[];

                var calma = [],
                    q1 = [],
                    q2 = [],
                    q3 = [],
                    q4 = [],
                    q5 = [];

                var limite_min = [];
                var limite_avg = [];
                var limite_max = [];
                var limiteAcum = [];
                var limiteAcumMin = [];
                var limiteAcumMax = [];

                var maxims = [], averages = [] , ranges = [];

                /*var limite_minAcum = [];
                var limite_maxAcum = [];*/
                var labelshidden = [];
                var periodo = '';
                var flag = false;
                /* FIN ARREGLO LO QUE SE MOSTRARA EN LOS GRAFICOS */

                switch(instantanea){
                    case undefined:
                        if ( loadedMarkersData[id]["STACK-DAY"] !== undefined ){
                            var ta_load = loadedMarkersData[id]["STACK-DAY"]
                            var k = 0;

                            if( (ta_load !== undefined) ){

                                Object.keys(ta_load).forEach(i => {

                                   if(i != 'ayer' && i != 'hoy' && i != 'manana' && i != 'pasado'){

                                       labels[k] = i;

                                       tmax[k] = ta_load[i]['TA-MAX'];
                                       tmin[k] = ta_load[i]['TA-MIN'];
                                       pp[k]    = ta_load[i]['PP-SUM'];

                                    }

                                    k+=1;

                                });
                            }
                        }
                        else{
                            labels = [null]; pp = [null]; ta = [null];
                        }
                    break;

                    case 'VV-AVG':
                        switch(stack_source){
                            case 'DIA':
                                if ( loadedMarkersData[id]["STACK-DAY"] !== undefined
                                        && loadedMarkersData[id]["STACK-DAY"]['hoy'] !== undefined
                                        && loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES'] !== undefined ){
                                    calma   = loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES']['CALMA'];
                                    q1      = loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES']['Q1'];
                                    q2      = loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES']['Q2'];
                                    q3      = loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES']['Q3'];
                                    q4      = loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES']['Q4'];
                                    q5      = loadedMarkersData[id]["STACK-DAY"]['hoy']['QUINTILES']['Q5'];
                                }
                                else{
                                    calma = q1 = q2 = q3 = q4 = q5 = [null];
                                }
                            break;

                            case 'AYER':
                                if ( loadedMarkersData[id]["STACK-DAY"] !== undefined
                                        && loadedMarkersData[id]["STACK-DAY"]['ayer'] !== undefined
                                        && loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES'] !== undefined ){
                                    calma   = loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES']['CALMA'];
                                    q1      = loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES']['Q1'];
                                    q2      = loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES']['Q2'];
                                    q3      = loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES']['Q3'];
                                    q4      = loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES']['Q4'];
                                    q5      = loadedMarkersData[id]["STACK-DAY"]['ayer']['QUINTILES']['Q5'];
                                }
                                else{
                                    calma = q1 = q2 = q3 = q4 = q5 = [null];
                                }
                            break;

                            case 'MES':
                                if ( loadedMarkersData[id]["STACK-MONTH"] !== undefined
                                        && loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'] !== undefined
                                        && loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year] !== undefined
                                        && loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES'] !== undefined ){
                                    calma   = loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES']['CALMA'];
                                    q1      = loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES']['Q1'];
                                    q2      = loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES']['Q2'];
                                    q3      = loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES']['Q3'];
                                    q4      = loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES']['Q4'];
                                    q5      = loadedMarkersData[id]["STACK-MONTH"]['VV-AVG'][current_month_year]['QUINTILES']['Q5'];
                                }
                                else{
                                    calma = q1 = q2 = q3 = q4 = q5 = [null];
                                }
                            break;

                            default:
                                if ( loadedMarkersData[id]["STACK-HOUR"] !== undefined ){

                                    var ta_load = loadedMarkersData[id]["STACK-HOUR"];
                                    var keys = Object.keys(ta_load);
                                    var k = 0;

                                    if( (ta_load !== undefined ) ){

                                        Object.keys(ta_load).forEach(i => {

                                           averages[k] = [new Date(keys[k]).getTime(), ta_load[i]['VV-AVG']!== null ? parseFloat(ta_load[i]['VV-AVG']) : null, ta_load[i]['DV-AVG']!== null ? parseFloat(ta_load[i]['DV-AVG']) : null];
                                           maxims[k]   = [new Date(keys[k]).getTime(), ta_load[i]['VV-MAX']!== null ? parseFloat(ta_load[i]['VV-MAX']) : null, ta_load[i]['DV-AVG']!== null ? parseFloat(ta_load[i]['DV-AVG']) : null];

                                           if( ta_load[i]['VV-AVG'] !== null){
                                                flag = true;
                                           }
                                            k+=1;
                                        });

                                    }
                                }
                                else{
                                    labels = [null]; pp = [null]; ta = [null];
                                }

                            break;
                        }
                    break;

                    case 'TA-AVG':
                    case 'TA-MIN':
                    case 'TA-MAX':
                        switch(stack_source){
                            case undefined:
                                if ( loadedMarkersData[id]["STACK-HOUR"] !== undefined ){

                                    var ta_load = loadedMarkersData[id]["STACK-HOUR"];
                                    var ta_load_h = loadedMarkersData_h ? loadedMarkersData_h[id]["STACK-HOUR"] : undefined;
                                    var keys = Object.keys(ta_load);
                                    var k = 0;

                                    if( (ta_load !== undefined ) ){

                                        Object.keys(ta_load).forEach(i => {

                                           averages[k] = [new Date(keys[k]).getTime(), ta_load[i]['TA-AVG']!== null ? parseFloat(ta_load[i]['TA-AVG']) : null];
                                           if( ta_load[i]['TA-AVG'] !== null){
                                                flag = true;
                                           }

                                            if (ta_load_h !== undefined && ta_load_h[i] !== undefined ){

                                                ranges[k]   =   [new Date(keys[k]).getTime(), ta_load_h[i].min_abs !== null ? parseFloat(ta_load_h[i].min_abs) : null, ta_load_h[i].max_abs !== null ? parseFloat(ta_load_h[i].max_abs) : null];
                                                periodo =   ta_load_h[i].periodo;
                                            }
                                            else{
                                                ranges[k]   =   [new Date(keys[k]).getTime(), null, null];
                                            }
                                            k+=1;
                                        });

                                    }
                                }
                                else{
                                    labels = [null]; pp = [null]; ta = [null];
                                }
                            break;

                            case 'DIARIO':
                            case '24':
                                if ( loadedMarkersData[id]["STACK-DAY"] !== undefined ){
                                    instantaneaName = 'Temperatura del Aire';

                                    var ta_load = loadedMarkersData[id]["STACK-DAY"];
                                    var ta_load_h = loadedMarkersData_h ? loadedMarkersData_h[id]["STACK-DAY"] : undefined;
                                    var keys = Object.keys(ta_load);
                                    var k = 0;

                                    Object.keys(ta_load).forEach(i => {
                                        if(i != 'ayer' && i != 'hoy' && i != 'manana' && i != 'pasado'){

                                           averages[k] = [new Date(keys[k]).getTime(), ta_load[i]['TA-AVG']!== null ? parseFloat(ta_load[i]['TA-AVG']) : null];
                                           if( ta_load[i]['TA-AVG'] !== null){
                                                flag = true;
                                           }

                                            if (ta_load_h !== undefined && ta_load_h[i] !== undefined ){

                                                ranges[k]   =   [new Date(keys[k]).getTime(), ta_load_h[i].min_abs !== null ? parseFloat(ta_load_h[i].min_abs) : null, ta_load_h[i].max_abs !== null ? parseFloat(ta_load_h[i].max_abs) : null];
                                                periodo =   ta_load_h[i].periodo;
                                            }
                                            else{
                                                ranges[k]   =   [new Date(keys[k]).getTime(), null, null];
                                            }
                                            k+=1;
                                        }
                                    });

                                }
                                else{
                                    console.log('void')
                                    ranges = [null]; averages = [null]; periodo = [null];
                                }
                        }

                        break;
                    default:
                        switch(stack_source){
                            case undefined:
                            case 'DIARIO':
                            case '24':
                            case 'AYER':
                            case 'ANTEAYER':
                                if ( loadedMarkersData[id]["STACK-HOUR"] !== undefined ){

                                    var ta_load = loadedMarkersData[id]["STACK-HOUR"];
                                    var keys = Object.keys(ta_load);
                                    var k = 0;

                                    if( (ta_load !== undefined ) ){
                                        let count_null=0;

                                        Object.keys(ta_load).forEach(i => {

                                           labels[k] = keys[k];
                                           insta[k] = ta_load[i][instantanea];

                                           if(ta_load[i] === null){
                                                count_null+=1;
                                           }
                                           else{
                                                limite_min[k]   =   null;
                                                limite_max[k]   =   null;
                                                labelshidden[k] =   null;
                                            }

                                           k+=1;
                                        });

                                        /*if (count_null>0 && k==count_null){
                                            resultsHtml.pop();

                                            idx.splice( idx.indexOf(id), 1 ); // Find the index position of "foo," then remove one element from that position
                                            console.log('id:' + id + '  ' +loadedMarkersData[id]['nombre']+ ' : ' + count_null +' k : '+k)
                                        }*/

                                    }
                                }
                                else{
                                    labels = [null]; pp = [null]; ta = [null];
                                }
                            break;

                            case 'ANUAL':
                                if ( loadedMarkersData[id]["STACK-MONTH"] !== undefined && loadedMarkersData[id]["STACK-MONTH"][instantanea] !== undefined ){

                                    var ta_load = loadedMarkersData[id]["STACK-MONTH"][instantanea];
                                    var keys = Object.keys(ta_load);
                                    var k = 0;

                                    if( (ta_load !== undefined ) ){
                                        let count_null = 0;

                                        Object.keys(ta_load).forEach(i => {

                                           labels[k] = keys[k];
                                           insta[k] = ta_load[i].valor ;


                                            if (instaAcum[k-1] !== undefined){
                                                if(ta_load[i].valor !== null){
                                                    instaAcum[k] = (eval(ta_load[i].valor) + eval(instaAcum[k-1])).toFixed(1);
                                                }
                                            }
                                            else{
                                                instaAcum[k] = insta[k];
                                            }

                                            if(ta_load[i].limites !== undefined ){
                                                limite_min[k] = ta_load[i].limites.min;
                                                limite_max[k] = ta_load[i].limites.max;

                                                if (ta_load[i].limites.desde === ta_load[i].limites.hasta){
                                                    labelshidden[k] = ta_load[i].limites.desde;
                                                }
                                                else{
                                                    labelshidden[k] = ta_load[i].limites.desde + '-' + ta_load[i].limites.hasta;
                                                }
                                            }


                                           /*if (limite_minAcum[k-1] !== undefined){
                                                if(ta_load[i].limites !== undefined ){
                                                    limite_minAcum[k] = (eval(ta_load[i].limites.min) + eval(limite_minAcum[k-1])).toFixed(1);
                                                    limite_maxAcum[k] = (eval(ta_load[i].limites.max) + eval(limite_maxAcum[k-1])).toFixed(1);

                                                    if (ta_load[i].limites.desde === ta_load[i].limites.hasta){
                                                        labelshidden[k] = ta_load[i].limites.desde;
                                                    }
                                                    else{
                                                        labelshidden[k] = ta_load[i].limites.desde + '-' + ta_load[i].limites.hasta;
                                                    }
                                                }
                                           }
                                           else{
                                                limite_minAcum[k] = ta_load[i].limites === undefined ? null : ta_load[i].limites.min;
                                                limite_maxAcum[k] = ta_load[i].limites === undefined ? null : ta_load[i].limites.max;

                                                if (ta_load[i].limites !== undefined ){
                                                    if (ta_load[i].limites.desde === ta_load[i].limites.hasta){
                                                        labelshidden[k] = ta_load[i].limites.desde;
                                                    }
                                                    else{
                                                        labelshidden[k] = ta_load[i].limites.desde + '-' + ta_load[i].limites.hasta;
                                                    }
                                                }
                                                else{
                                                    labelshidden[k] = null;
                                                }
                                           }*/


                                           if(ta_load[i].valor === null){
                                                count_null+=1;
                                           }

                                           k+=1;
                                        });

                                        /*if (count_null>0 && k==count_null){
                                            resultsHtml.pop();

                                            idx.splice( idx.indexOf(id), 1 ); // Find the index position of "foo," then remove one element from that position
                                            console.log('id:' + id + '  ' +loadedMarkersData[id]['nombre']+ ' : ' + count_null +' k : '+k)
                                        }*/

                                    }
                                }
                                else{
                                    labels = [null]; pp = [null]; ta = [null];
                                }
                            break;
                        }
                }
                /*
                    ARAMADO DE GRAFICOS
                 */

                switch(instantanea){
                    case undefined:
                        config[id] = {
                                type: 'bar',
                                data: {
                                    labels: labels,
                                    datasets: [ {
                                        type: 'line',
                                        label: 'Temperatura Máx.',
                                        backgroundColor: color(window.chartColors.red).alpha(0.2).rgbString(),
                                        borderColor: window.chartColors.red,
                                        data: tmax,
                                        fill: false,
                                        yAxisID: 'y-axis-2'
                                    },
                                    {
                                        type: 'line',
                                        label: 'Temperatura Mín.',
                                        backgroundColor: color(window.chartColors.blue).alpha(0.2).rgbString(),
                                        borderColor: window.chartColors.blue,
                                        data: tmin,
                                        fill: false,
                                        yAxisID: 'y-axis-2'
                                    },
                                    {
                                        type: 'bar',
                                        label: 'Precipitación Acum.',
                                        backgroundColor: color(window.chartColors.grey).alpha(0.7).rgbString(),
                                        borderColor: window.chartColors.grey,
                                        data: pp,
                                        fill: false,
                                        yAxisID: 'y-axis-1'
                                    }]
                                },
                                options: {
                                    responisve: true,
                                    legend:{
                                        display: false
                                    },
                                    title: {
                                        text: 'titulo',
                                        display: false,
                                    },
                                    tooltips: {
                                        mode: 'index',
                                        intersect: false,

                                        callbacks: {
                                            label: function(tooltipItems, data) {

                                                switch(data.datasets[tooltipItems.datasetIndex].yAxisID){
                                                    case 'y-axis-1':
                                                        return data.datasets[tooltipItems.datasetIndex].label + ': ' + ( isNaN(tooltipItems.yLabel) ? 's/i' : tooltipItems.yLabel + ' mm' );
                                                        break;

                                                    case 'y-axis-2':
                                                    case 'y-axis-3':
                                                        return data.datasets[tooltipItems.datasetIndex].label + ': ' + ( isNaN(tooltipItems.yLabel) ? 's/i' : tooltipItems.yLabel + ' ºC' );
                                                        break;
                                                }

                                            }
                                        },
                                        footerFontStyle: 'normal'
                                    },
                                    /*hover: {
                                        mode: 'nearest',
                                        intersect: true
                                    },*/
                                    scales: {
                                        xAxes: [{
                                            type: 'time',
                                            display: true,
                                            time: {
                                                parser: timeFormat,
                                                tooltipFormat: 'DD-MM-YYYY',
                                                unit: 'day'
                                            }

                                        }],
                                        yAxes: [{
                                            display: true,
                                            id: 'y-axis-1',
                                            position: 'right',
                                            scaleLabel: {
                                                display: true,
                                                labelString: 'mm',
                                                padding: 0
                                            },
                                            ticks: {
                                                min: 0,
                                                stepSize: 10,
                                                suggestedMax: eval(instantaneaQ_PP['q4'])
                                            },
                                            gridLines: {
                                                display: true
                                            }
                                        },
                                        {
                                            display: true,
                                            id: 'y-axis-2',
                                            position: 'left',
                                            scaleLabel: {
                                                display: true,
                                                labelString: 'ºC',
                                                padding: 0
                                            },
                                            ticks: {
                                                suggestedMin: 0,
                                                suggestedMax: 45
                                            },
                                            gridLines: {
                                                display: true,
                                            }
                                        }],
                                    },

                                    elements: {
                                        point: {
                                            hoverBackgroundColor: makeHalfAsOpaque,
                                            radius: adjustRadiusBasedOnData,
                                            pointStyle: 'circle',
                                            hoverRadius: 6,
                                        }
                                    }
                                }
                        };
                        break;

                    case 'VV-AVG':
                        if (stack_source == 'DIA' || stack_source == 'AYER' || stack_source == 'MES'){
                            config[id] = [{
                                name: 'calma',
                                data: calma

                            }, {
                                name: '1 - 5 km/h',
                                data: q1

                            }, {
                                name: '5 - 11 km/h',
                                data: q2

                            }, {
                                name: '11 - 19 km/h',
                                data: q3
                            }, {
                                name: '19 - 28 km/h',
                                data: q4

                            }, {
                                name: '&gt; 28 km/h',
                                data: q5
                            }];
                        }
                        else{
                            averages_check_flag[id] = flag;

                            config[id] = {
                                title: {
                                    text: 'Velocidad y Dirección de Viento'
                                },
                                subtitle: {
                                    text: 'últimas 12 horas'
                                },

                                xAxis: {
                                    type: 'datetime',
                                    offset: 50
                                },
                                 yAxis: {
                                    title: {
                                    text: null
                                 },
                                min : 0,
                                minRange: 20,
                                tickInterval: 5
                                    /*min : 0,
                                    max : 60,
                                    tickInterval: 20*/
                                },
                                series: [
                                {
                                    type: 'windbarb',
                                    data: averages,
                                    name: 'Velocidad de Viento',
                                    yOffset: -35,
                                    color: Highcharts.getOptions().colors[0],
                                    showInLegend: false,
                                    tooltip: {
                                        valueSuffix: ' km/h'
                                    }
                                },
                                {
                                    type: 'windbarb',
                                    data: maxims,
                                    name: 'Ráfaga de Viento',
                                    yOffset: -10,
                                    color: Highcharts.getOptions().colors[5],
                                    showInLegend: false,
                                    tooltip: {
                                        valueSuffix: ' km/h'
                                    }
                                },


                                {
                                    type: 'area',
                                    keys: ['x', 'y', 'rotation'], // rotation is not used here
                                    data: maxims,
                                    color: Highcharts.getOptions().colors[5],
                                    fillColor: {
                                        linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
                                        stops: [
                                            [0, Highcharts.getOptions().colors[5]],
                                            [
                                                1,
                                                Highcharts.color(Highcharts.getOptions().colors[5])
                                                    .setOpacity(0.00008).get()
                                            ]
                                        ]
                                    },
                                    name: 'Ráfaga de Viento',
                                    tooltip: {
                                        valueSuffix: ' km/h'
                                    },
                                    states: {
                                        inactive: {
                                            opacity: 0.5
                                        }
                                    }
                                },{
                                    type: 'area',
                                    keys: ['x', 'y', 'rotation'], // rotation is not used here
                                    data: averages,
                                    color: Highcharts.getOptions().colors[0],
                                    fillColor: {
                                        linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
                                        stops: [
                                            [0, Highcharts.getOptions().colors[0]],
                                            [
                                                1,
                                                Highcharts.color(Highcharts.getOptions().colors[0])
                                                    .setOpacity(1).get()
                                            ]
                                        ]
                                    },
                                    name: 'Velocidad de Viento',
                                    tooltip: {
                                        valueSuffix: ' km/h'
                                    },
                                    states: {
                                        inactive: {
                                            opacity: 0.5
                                        }
                                    }
                                }]

                            }
                        }
                        break;

                    case 'TA-AVG':
                    case 'TA-MIN':
                    case 'TA-MAX':

                        averages_check_flag[id] = flag;

                        config[id] = {
                            title: {
                                text: 'Temperatura del Aire (ºC)'
                            },

                            xAxis: {
                                type: 'datetime'
                            },

                            yAxis: {
                                title: {
                                    text: null
                                },
                                min : -20,
                                max : 40,
                                tickInterval: 20
                           },

                            tooltip: {
                                crosshairs: true,
                                shared: true,
                                valueSuffix: '°C'
                            },

                            series: [{
                                name: 'Temperatura del Aire ',
                                data: averages,
                                zIndex: 1,
                                color: Highcharts.getOptions().colors[0],
                                marker: {
                                    enabled: false
                                }
                                /*marker: {
                                    fillColor: 'white',
                                    lineWidth: 1,
                                    lineColor: Highcharts.getOptions().colors[0]
                                }*/
                            }, {
                                name: 'Mín. y Máx. [' + periodo +'] ',
                                data: ranges,
                                type: 'arearange',
                                lineWidth: 0,
                                linkedTo: ':previous',
                                color: Highcharts.getOptions().colors[0],
                                fillOpacity: 0.2,
                                zIndex: 0,
                                marker: {
                                    enabled: false
                                }
                            }]
                        };
                        break;

                    case 'PP-SUM':
                        if (stack_source == 'ANUAL'){
                            config[id] = {
                                    type: 'bar',
                                    data: {
                                        labels: labels,
                                        datasets: [
                                        {
                                            type: 'bar',
                                            label: 'Precipitación Mensual',
                                            backgroundColor: color(window.chartColors.blue).alpha(0.7).rgbString(),
                                            borderColor: window.chartColors.blue,
                                            data: insta,
                                            fill: false,
                                            yAxisID: 'y-axis-1'
                                        },
                                        {
                                            type: 'line',
                                            label: 'Acumulada ',
                                            backgroundColor: color(window.chartColors.red).alpha(0.5).rgbString(),
                                            borderColor: window.chartColors.red,
                                            data: instaAcum,
                                            fill: false,
                                            yAxisID: 'y-axis-1'
                                        },
                                        {
                                            type: 'line',
                                            label: 'Acum. Máx.',
                                            backgroundColor: color(window.chartColors.grey).alpha(1).rgbString(),
                                            borderColor: window.chartColors.grey,
                                            data: limite_max,
                                            labelhidden: labelshidden,
                                            fill: false,
                                            yAxisID: 'y-axis-1',
                                            borderDash: [5, 5],
                                        },
                                        {
                                            type: 'line',
                                            label: 'Acum. Mín.',
                                            backgroundColor: color(window.chartColors.grey).alpha(1).rgbString(),
                                            borderColor: window.chartColors.grey,
                                            data: limite_min,
                                            labelhidden: labelshidden,
                                            fill: false,
                                            yAxisID: 'y-axis-1',
                                            borderDash: [5, 5],
                                        }]
                                    },
                                    options: {
                                        responisve: true,
                                        legend:{
                                            display: false
                                        },
                                        title: {
                                            text: 'titulo',
                                            display: false,
                                        },
                                        tooltips: {
                                            mode: 'index',
                                            intersect: false,

                                            callbacks: {
                                                label: function(tooltipItems, data) {
                                                    var index = tooltipItems.index;
                                                    var datasetIndex = tooltipItems.datasetIndex;
                                                    var label = data.datasets[tooltipItems.datasetIndex].label || '';
                                                    var value = data.datasets[datasetIndex].data[index];

                                                    var labelhidden = data.datasets[tooltipItems.datasetIndex].labelhidden || '';


                                                    if (value === null ){
                                                        return '';
                                                    }
                                                    else{
                                                        if (datasetIndex == 2 || datasetIndex == 3){
                                                            return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' mm [ ' + labelhidden[index] + ' ]';
                                                        }
                                                        else{
                                                            return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' mm';
                                                        }
                                                    }

                                                }
                                            },
                                            footerFontStyle: 'normal'
                                        },
                                        /*hover: {
                                            mode: 'nearest',
                                            intersect: true
                                        },*/
                                        scales: {
                                            xAxes: [{
                                                type: 'time',
                                                display: true,
                                                time: {
                                                    parser: timeFormat,
                                                    tooltipFormat: 'MMM, YYYY',
                                                    displayFormats: {
                                                        day: 'D MMM'
                                                    },
                                                    round: 'day'
                                                },
                                                scaleLabel: {
                                                    display:     true,
                                                },
                                                ticks: {
                                                    callback: function(label, index, labels ){
                                                        return moment.monthsShort(index % 12, "MMM");
                                                    }
                                                }
                                            }],
                                            yAxes: [{
                                                display: true,
                                                id: 'y-axis-1',
                                                position: 'left',
                                                scaleLabel: {
                                                    display: true,
                                                    labelString: 'mm',
                                                    padding: 0
                                                },
                                                ticks: {
                                                    min: 0,
                                                    //stepSize: 400,
                                                    suggestedMax: eval(instantaneaQ['q9']+100)
                                                },
                                                gridLines: {
                                                    display: true
                                                }
                                            }/*,
                                            {
                                                display: true,
                                                id: 'y-axis-1',
                                                position: 'left',
                                                scaleLabel: {
                                                    display: true,
                                                    labelString: 'mm Mensual',
                                                    padding: 0
                                                },
                                                ticks: {
                                                    min: 0,
                                                    stepSize: 100,
                                                    //suggestedMax: eval(instantaneaQ_TA['q4'])
                                                },
                                                gridLines: {
                                                    display: true,
                                                }
                                            }*/],
                                        },
                                    }
                            };
                            break;
                        }
                        else{
                            /* no aplico break */
                        }

                    default:

                        config[id] = {
                            type: (instantanea == 'PP-SUM') ? 'bar' : 'line',
                            data: {
                                labels: labels,
                                datasets: [{
                                    type: (instantanea == 'PP-SUM') ? 'bar' : 'line',
                                    label: instantaneaName,
                                    backgroundColor: color(window.chartColors.blue).alpha(0.5).rgbString(),
                                    borderColor: window.chartColors.blue,
                                    data: insta,
                                    fill: false,
                                    yAxisID: 'y-axis-' + instantanea
                                }/*,
                                {
                                    type: 'line',
                                    label: 'Máxima',
                                    backgroundColor: color(window.chartColors.grey).alpha(1).rgbString(),
                                    borderColor: window.chartColors.grey,
                                    data: limite_max,
                                    labelhidden: labelshidden,
                                    fill: false,
                                    yAxisID: 'y-axis-1',
                                    borderDash: [5, 5],
                                },
                                {
                                    type: 'line',
                                    label: 'Mínima',
                                    backgroundColor: color(window.chartColors.grey).alpha(1).rgbString(),
                                    borderColor: window.chartColors.grey,
                                    data: limite_min,
                                    labelhidden: labelshidden,
                                    fill: false,
                                    yAxisID: 'y-axis-1',
                                    borderDash: [5, 5],
                                }*/
                                ]
                            },
                            options: {
                                responisve: true,
                                legend:{
                                    display: false
                                },
                                title: {
                                    text: 'titulo',
                                    display: false,
                                },
                                tooltips: {
                                    mode: 'index',
                                    intersect: false,

                                    callbacks: {
                                        label: function(tooltipItems, data) {
                                            //console.log(data.datasets[1].data[tooltipItems.index])
                                            //console.log(tooltipItems.index)

                                            switch(data.datasets[tooltipItems.datasetIndex].yAxisID){

                                                case 'y-axis-TS00-AVG':
                                                case 'y-axis-TS10-AVG':
                                                    return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' ºC';
                                                    break;

                                                case 'y-axis-PP-SUM':
                                                    return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' mm';
                                                    break;

                                                case 'y-axis-HR-AVG':
                                                    return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' %';
                                                    break;

                                                case 'y-axis-PS-AVG':
                                                    return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' mbar';
                                                    break;

                                                case 'y-axis-RD-AVG':
                                                    return data.datasets[tooltipItems.datasetIndex].label + ': ' + tooltipItems.yLabel + ' w/m\u00b2';
                                                    break;
                                            }

                                        }
                                    },
                                    footerFontStyle: 'normal'
                                },
                                /*hover: {
                                    mode: 'nearest',
                                    intersect: true
                                },*/
                                scales: {
                                    xAxes: [{
                                        type: 'time',
                                        display: true,
                                        time: {
                                            parser: timeFormat,
                                            tooltipFormat: 'DD-MM-YYYY HH:00',
                                            displayFormats: {
                                                'hour': 'HH'
                                            },
                                            round: 'hour'
                                        }
                                    }],
                                    yAxes: [{
                                        display: true,
                                        id: 'y-axis-'+ instantanea,
                                        position: 'left',
                                        scaleLabel: {
                                            display: true,
                                            labelString: instantaneaUnit,
                                            padding: 0
                                        },
                                        ticks: {
                                            suggestedMin: eval(instantaneaQ['q1']),
                                            suggestedMax: (instantanea == 'HR-AVG') ? 100 : (instantanea == 'RD-AVG' || instantanea == 'PS-AVG') ? 1200 : (eval(instantaneaQ['q9']) + 10) ,

                                            stepSize: (instantanea == 'PP-SUM') ? 5 : null,
                                        },
                                        gridLines: {
                                            display: true
                                        }
                                    }
                                    ],
                                },

                                elements: {
                                    point: {
                                        hoverBackgroundColor: makeHalfAsOpaque,
                                        radius: adjustRadiusBasedOnData,
                                        pointStyle: 'circle',
                                        hoverRadius: 6,
                                    }
                                }

                            }
                        };
                        break;
                }

            }
        }

        $(".ts-results-wrapper").html(resultsHtml);


        var $results = $("#ts-results").find(".ts-sly-frame");
        if ($results.hasClass("ts-loaded")) {
            $results.sly("reload");
        }
        else {
            initializeSly();
        }

        var resultsBar = $(".scroll-wrapper.ts-results__vertical-list, .scroll-wrapper.ts-results__grid");
        if ($(window).width() < 575) {
            resultsBar.find(".ts-results__vertical").css("pointer-events", "none");
            resultsBar.on("click", function () {
                $(this).addClass("ts-expanded");
                $(this).find(".ts-results__vertical").css("pointer-events", "auto");
                $("#ts-map-hero").addClass("ts-dim-map");
            });

            $("#ts-map-hero").on("click", function(){
                if (resultsBar.hasClass("ts-expanded")) {
                    resultsBar.removeClass("ts-expanded");
                    $("#ts-map-hero").removeClass("ts-dim-map");
                    resultsBar.find(".ts-results__vertical").css("pointer-events", "none");
                }
            });
        }
        else {
            resultsBar.removeClass("ts-expanded");
            resultsBar.find(".ts-results__vertical").css("pointer-events", "auto");
            $("#ts-map-hero").removeClass("ts-dim-map");
        }


        Highcharts.seriesTypes.windbarb.prototype.beaufortName = [
        'Calma', 'Aire ligero', 'Brisa ligera',
        'Brisa suave', 'Brisa moderada', 'Brisa fresca',
        'Brisa fuerte', 'Vendaval cercano', 'Vendaval', 'Vendaval fuerte', 'Tormenta',
        'Tormenta violenta', 'Huracán'];

        Highcharts.seriesTypes.windbarb.prototype.beaufortFloor = [0, 1,5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117];

        Highcharts.seriesTypes.windbarb.prototype.windArrow = function(point)
        {
          var knots = point.value * 0.539957, //valor para convertir kph a nudos
            level = point.beaufortLevel,
            path,
            barbs,
            u = this.options.vectorLength / 20,
            pos = -10;

          if (point.isNull) {
            return [];
          }

          if (level === 0) {
            return this.chart.renderer.symbols.circle(-10 * u, -10 * u,
              20 * u,
              20 * u
            );
          }

          // El tallo y la punta de flecha
          path = [
            'M', 0, 7 * u, // base of arrow
            'L', -1.5 * u, 7 * u,
            0, 10 * u,
            1.5 * u, 7 * u,
            0, 7 * u,
            0, -10 * u // top
          ];

          // Por cada 50 nudos completos, agregue un banderín
          barbs = (knots - knots % 50) / 50; // pennants
          if (barbs > 0) {
            while (barbs--) {
              path.push(
                pos === -10 ? 'L' : 'M',
                0,
                pos * u,
                'L',
                5 * u,
                pos * u + 2,
                'L',
                0,
                pos * u + 4

              );

              // Substract from the rest and move position for next
              knots -= 50;
              pos += 7;
            }
          }

          // Por cada 10 nudos completos, agregue una púa completa
          barbs = (knots - knots % 10) / 10;
          if (barbs > 0) {
            while (barbs--) {
              path.push(
                pos === -10 ? 'L' : 'M',
                0,
                pos * u,
                'L',
                7 * u,
                pos * u
              );
              knots -= 10;
              pos += 3;
            }
          }

         //Por cada 5 nudos completos, agregue media púa
          barbs = (knots - knots % 5) / 5; // media púa
          if (barbs > 0) {
            while (barbs--) {
              path.push(
                pos === -10 ? 'L' : 'M',
                0,
                pos * u,
                'L',
                4 * u,
                pos * u
              );
              knots -= 5;
              pos += 3;
            }
          }
          return path;
        };

        Highcharts.setOptions({
            lang: {
                contextButtonTitle: "opciones",
                viewFullscreen: "ver en pantalla completa",
                downloadJPEG: "descargar JPEG",
                downloadPDF: "descargar PDF",
                downloadPNG: "descargar PNG",
                printChart: "imprimir",
                weekdays: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sabado"],
                shortMonths: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
            },
            exporting: {
                buttons: {
                    contextButton: {
                        menuItems: ['downloadPNG']
                    }
                }
            },
            time: {
                useUTC: stack_source !== undefined ? true : false,
            },
            credits:{
                text: 'Instituto de Investigaciones Agropecuarias (INIA) | agrometeorologia.cl',
                href: false
            },
            legend: {
                enabled: false
            },
            subtitle: {
                text: null
            },
            caption: {
                text: '.'
            },
            chart: {
                styledMode: false
            },
        });

        for (var i = 0; i < idx.length; i++) {

            switch(instantanea){
                case 'TA-AVG':
                case 'TA-MIN':
                case 'TA-MAX':
                    if (averages_check_flag[idx[i]]){

                        var element = 'highchart-'+idx[i];

                        if (typeof(element) !== 'undefined' && element !== null  ){

                            new Highcharts.Chart(''+ element +'', config[idx[i]]);
                        }
                    }
                break;

                case 'VV-AVG':
                    if(stack_source !== undefined){

                        var element = 'highchart-'+idx[i];
                        if (typeof(element) !== 'undefined' && element !== null){
                            Highcharts.chart(''+ element +'', {
                                series:  config[idx[i]] ,

                                chart: {
                                    polar: true,
                                    type: 'column'
                                },

                                title: {
                                    text: ''
                                },

                                subtitle: {
                                    text: ''
                                },

                                pane: {
                                    size: '85%'
                                },

                                legend: {
                                    align: 'right',
                                    verticalAlign: 'middle',
                                    layout: 'vertical'
                                },

                                xAxis: {
                                    tickmarkPlacement: 'on',
                                    categories: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']

                                },

                                yAxis: {
                                    min: 0,
                                    endOnTick: false,
                                    showLastLabel: true,
                                    title: {
                                        text: '% tiempo'
                                    },
                                    labels: {
                                        formatter: function () {
                                            return this.value + '%';
                                        }
                                    },

                                    reversedStacks: false
                                },

                                tooltip: {
                                    formatter: function() {
                                        if (this.series.name == 'calma'){
                                            return this.series.name + ' : <b>' + this.y + '% del tiempo</b>';
                                        }
                                        else{
                                            return CARDINALIDAD[this.key] + ' <br>' +this.series.name + ' : <b>' + this.y + '% del tiempo</b>';
                                        }
                                    }
                                },

                                plotOptions: {
                                    series: {
                                        stacking: 'normal',
                                        shadow: false,
                                        groupPadding: 0,
                                        pointPlacement: 'on'
                                    }
                                }
                            });
                        }
                    }
                    else{
                         if (averages_check_flag[idx[i]]){

                            var element = 'highchart-'+idx[i];
                            if (typeof(element) !== 'undefined' && element !== null  ){

                                new Highcharts.Chart(''+ element +'', config[idx[i]]);
                            }
                        }
                    }
                    break;


                default:
                    var element = document.getElementById('canvas-'+idx[i]);

                    if (typeof(element) !== 'undefined' && element !== null){
                        var ctx = element.getContext('2d');
                        window.myLine = new Chart(ctx, config[idx[i]]);
                        //window.myLine.update();
                    }
            }


        }
    }

    function makeHalfAsOpaque(ctx) {
        var c = ctx.dataset.backgroundColor;
        return Samples.utils.transparentize(c);
    }

    function adjustRadiusBasedOnData(ctx) {
        var v = ctx.dataset.data[ctx.dataIndex];
        return v <= 0 ? 5 : 1;
    }

    // Center map on result click (Disabled)
    //==============================================================================================================

    $(document).on("click", ".ts-center-marker", function () {
        $(".ts-marker").parent().removeClass("ts-active-marker");
        map.setView( newMarkers[ $(this).parent().attr("data-ts-ln") ].getLatLng() );
        var id = $(this).parent().attr("data-ts-id");
        $(".ts-marker[data-ts-id='" + id + "']").parent().addClass("ts-active-marker");
    });

    // Highlight marker on result hover
    //==============================================================================================================

    var timer;
    $(document).on({
        mouseenter: function () {
            var id = $(this).parent().attr("data-ts-id");
            timer = setTimeout(function(){
                $(".ts-marker").parent().addClass("ts-marker-hide");
                $(".ts-marker[data-ts-id='" + id + "']").parent().addClass("ts-active-marker");
            }, 500);
        },
        mouseleave: function () {
            clearTimeout(timer);
            $(".ts-marker").parent().removeClass("ts-active-marker").removeClass("ts-marker-hide");
        }
    }, ".ts-result");

    function formatPrice(price) {
        return Number(price).toLocaleString(locale, {style: 'currency', currency: currency}).replace(/\D\d\d$/, '');
    }


    var simpleMapId = "ts-map-simple";
    if( $("#"+simpleMapId).length ){

        mapElement = $(document.getElementById(simpleMapId));
        mapDefaultZoom = parseInt(mapElement.attr("data-ts-map-zoom"), 10);
        centerLatitude = mapElement.attr("data-ts-map-center-latitude");
        centerLongitude = mapElement.attr("data-ts-map-center-longitude");
        controls = parseInt(mapElement.attr("data-ts-map-controls"), 10);
        scrollWheel = parseInt(mapElement.attr("data-ts-map-scroll-wheel"), 10);
        leafletMapProvider = mapElement.attr("data-ts-map-leaflet-provider");
        var markerDrag = parseInt( mapElement.attr("data-ts-map-marker-drag"), 10 );


        if (!mapDefaultZoom) {
            mapDefaultZoom = 14;
        }

        map = L.map(simpleMapId, {
            zoomControl: false,
            scrollWheelZoom: scrollWheel
        });
        map.setView([centerLatitude, centerLongitude], mapDefaultZoom);

        L.tileLayer(leafletMapProvider, {
            attribution: leafletAttribution,
            id: mapBoxId,
            accessToken: mapBoxAccessToken
        }).addTo(map);

        ( controls === 1 ) ? L.control.zoom({position: "topright"}).addTo(map) : "";

        var icon = L.icon({
            iconUrl: "assets/img/marker-small.png",
            iconSize: [22, 29],
            iconAnchor: [11, 29]
        });

        var marker = L.marker([centerLatitude, centerLongitude],{
            icon: icon,
            draggable: markerDrag
        }).addTo(map);

    }

    function appendLeadingZeroes(n){
      if(n <= 9){
        return "0" + n;
      }
      return n
    }

    function cardinal(num){
        var arr = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
        var val = Math.floor((eval(num) / 45) );
        return arr[(val % 8)];
    }
});
