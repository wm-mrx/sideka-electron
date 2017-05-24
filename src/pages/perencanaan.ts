var $ = require('jquery');
import { remote, app as remoteApp, shell } from "electron";
import * as fs from "fs";
import { apbdesImporterConfig, Importer } from '../helpers/importer';
import { exportApbdes } from '../helpers/exporter';
import { Siskeudes } from '../stores/siskeudes';
import dataApi from "../stores/dataApi";
import settings from '../stores/settings';
import schemas from '../schemas';
import { initializeTableSearch, initializeTableCount, initializeTableSelected } from '../helpers/table';
import SumCounter from "../helpers/sumCounter";
import DiffTracker from "../helpers/diffTracker";
import { Diff } from "../helpers/diffTracker";
import titleBar from '../helpers/titleBar';

import { Component, ApplicationRef, NgZone, HostListener} from "@angular/core";
import {ActivatedRoute} from "@angular/router";

const path = require("path");
const jetpack = require("fs-jetpack");
const Docxtemplater = require('docxtemplater');
const Handsontable = require('./handsontablep/dist/handsontable.full.js');

const categories = [{
    category: "renstra",
    fields:[['ID_Visi','Visi','Uraian_Visi'],['ID_Misi','Misi','Uraian_Misi'],['ID_Tujuan','Tujuan','Uraian_Tujuan'],['ID_Sasaran','Sasaran','Uraian_Sasaran']],
    currents:[{fieldName:'ID_Visi',value:'',lengthId:0},{fieldName:'ID_Misi',value:'',lengthId:2},{fieldName:'ID_Tujuan',value:'',lengthId:4},{fieldName:'ID_Sasaran',value:'',lengthId:6}]
}]

enum Types { Visi=0, Misi=2, Tujuan=4, Sasaran=6};

var app = remote.app;

var sheetContainer;
var appDir = jetpack.cwd(app.getAppPath());
var DATA_DIR = app.getPath("userData");

window['jQuery'] = $;
window['app'] = app;
window['hots'] = {};
require('./node_modules/bootstrap/dist/js/bootstrap.js');

@Component({
    selector: 'perencanaan',
    templateUrl: 'templates/perencanaan.html',
    host: {
        '(window:resize)': 'onResize($event)'
    }
})

export default class PerencanaanComponent {
    siskeudes:any;   
    activeSheet: string; 
    sheets: any;   
    idVisi:string;
    tahunAnggaran:string;
    sub:any;
    rpjmYears:any;
    savingMessage: string;
    initialDatasets:any={};
    hots:any={};
    activeHot:any;
    isFileMenuShown = false;
    contentSelection:any[];
    contentSelectMisi:any[];
    codeKegiatan:string;
    categorySelected:string;
    diffTracker: DiffTracker;
    regionCode:string;    

    constructor(private appRef: ApplicationRef, private zone: NgZone, private route:ActivatedRoute){ 
        this.appRef = appRef;       
        this.zone = zone;
        this.route = route;      
        this.diffTracker = new DiffTracker();
        this.siskeudes = new Siskeudes(settings.data["siskeudes.path"]); 
        this.sheets =  ['renstra','rpjm','rkp1','rkp2','rkp3','rkp4','rkp5','rkp6'];
        this.activeSheet ='renstra';
        this.sub = this.route.queryParams.subscribe(params=>{
            this.idVisi = params['id_visi'];  
            this.tahunAnggaran = params['first_year'] +'-'+ params['last_year'];
            this.regionCode = params['kd_desa'];
        });
    }

    ngOnInit(){  
        let that = this;
        this.sheets.forEach(type => {
            let sheetContainer = document.getElementById('sheet-'+type);
            this.hots[type] = this.createSheet(sheetContainer, type);

            window['hots'][type] = this.hots[type];
        });

        this.sheets.forEach(type=>{
            this.getContent(type,data=>{
                let hot = this.hots[type];
                this.initialDatasets[type] = data;                
                hot.loadData(data);
                if(type==='renstra'){
                    that.activeHot = hot;
                    setTimeout(function() {
                        that.activeHot.render();
                    }, 500);
                }

            })
        })
    }

    ngOnDestroy() {
        this.sub.unsubscribe();
    }

    onResize(event) {
        let that = this;
        this.activeHot= this.hots[this.activeSheet];
        setTimeout(function() {            
            that.activeHot.render()
        }, 200);
    }
    
    createSheet(sheetContainer,type){
        type = type.match(/[a-z]+/g)[0];

        let result = new Handsontable(sheetContainer, {
            data: [],
            topOverlay: 34,

            rowHeaders: true,
            colHeaders: schemas.getHeader(schemas[type]),        
            columns: schemas[type],

            colWidths: schemas.getColWidths(schemas[type]),
            rowHeights: 23,

            columnSorting: true,
            sortIndicator: true,
            hiddenColumns: {
                columns:schemas[type].map((c,i)=>{return (c.hiddenColumn==true) ? i:''}).filter(c=>c!== ''),
                indicators: true
            },
            outsideClickDeselects: false,
            autoColumnSize: false,
            search: true,
            schemaFilters: true,
            contextMenu: ['undo', 'redo', 'row_above', 'remove_row'],
            dropdownMenu: ['filter_by_condition', 'filter_action_bar'],
            
        });

        result.addHook("afterChange", (changes, source) => {
            if(source === 'edit' || source === 'undo' || source === 'autofill'){
                let renderer = false;

                changes.forEach(item => {
                    let row = item[0];
                    let col = item[1];
                    let prevValue = item[2];
                    let value = item[3];

                    if(col === 2)
                        renderer = true;
                });
            }
        });

        if(type=='renstra'){
            result.addHook("beforeRemoveRow", (index, amount) => {
                let rows = [];
                let data = result.getDataAtRow(index);
                let sourceData = result.getSourceData();
                let currentCode = data[0].replace(this.idVisi,'');
                
                for(let i=index;i<sourceData.length;i++){
                    let code = sourceData[i][0].replace(this.idVisi,'');     

                    if(code.slice(0,currentCode.length)!= currentCode)
                        break;

                    rows.push({index:i,data:sourceData[i]})
                }
            });            
        }

        return result;
    }
          
    selectTab(type){
        let that = this;

        this.clearFilters();
        this.activeSheet = type;      
        this.activeHot = this.hots[type];  
        
        setTimeout(function() {
            that.activeHot.render();
        }, 500);
    }

    transformData(source){        
        let results= [];       
        let category = categories.filter(c=>c.category==this.activeSheet)[0];  

        if(!category)return results;
        
        source.forEach(content=>{                    
            category.fields.forEach((field,idx)=>{
                let res = [];
                let current = category.currents[idx];
                let valueNulled = false;

                for(let i = 0; i < field.length;i++){
                    let value = content[field[i]]

                    if(!value){
                        let string = JSON.stringify(value);
                        if(string=='null') { valueNulled = true; break;}
                    }
                
                    let data = (content[field[i]]) ? content[field[i]] : field[i];
                    res.push(data)
                }

                if(valueNulled)return;
                if(current.value !== content[current.fieldName])results.push(res);     

                current.value = content[current.fieldName]; 
            })
            
        })

        return results;
    }

    getContent(type,callback){
        let results;
        switch(type){
            case "renstra":{ 
                this.siskeudes.getRenstraRPJM(this.idVisi,data=>{
                    results =  this.transformData(data);  
                    callback(results);
                });
                break;
            }
            case "rpjm":{
                this.siskeudes.getRPJM(this.idVisi,data=>{
                    results =  data.map(o => schemas.objToArray(o, schemas[type]));
                    callback(results);
                });
                break;
            }
            default:{
                let indexType = type.match(/\d+/g);
                this.siskeudes.getRKPByYear(this.idVisi,indexType,data=>{                   
                    results =  data.map(o => schemas.objToArray(o, schemas['rkp']));
                    callback(results);
                });
                break;
            }
        };

    }    

    saveContent(){
        let bundleSchemas = {};
        let bundleData = {};
        let me = this;
        let bundleName = 'perencanaan';

        this.sheets.forEach(type=>{
            let hot = this.hots[type];
            let sourceData = hot.getSourceData();
            let initialDataset = this.initialDatasets[type];

            let diffcontent = this.trackDiff(initialDataset, sourceData)

            if(diffcontent.total < 1)return;
            let bundle = this.bundleData(diffcontent);
            dataApi.saveToSiskeudesDB(bundle,response=>{

            });
        })
    };

    trackDiff(before, after): Diff {
        return this.diffTracker.trackDiff(before, after);
    }

    showFileMenu(isFileMenuShown){
        this.isFileMenuShown = isFileMenuShown;

        (isFileMenuShown) ? titleBar.normal() : titleBar.blue();
    }
    
    clearFilters(){    
        let filter = this.activeHot.getPlugin('Filters');    
        filter.clearFormulas();
        filter.filter();
        filter.conditionComponent._states = {};
    }
    
    addRow(){
        let type = this.activeSheet.match(/[a-z]+/g)[0];
        let lastRow;
        let position;
        let data = $("#form-add-"+type).serializeArray().map(i => i.value);
        let sourceData = this.activeHot.getSourceData();

        switch(type){
            case 'renstra':{
                let lastCode;

                if(data[0] !== 'misi'){
                    let code = data[1].replace(this.idVisi,''); 

                    for(let i = 0;i < sourceData.length; i++){
                        let codeSource = sourceData[i][0].replace(this.idVisi,'');

                        if(codeSource.length == code.length+2 && codeSource.slice(0,code.length) == code)
                            lastCode = sourceData[i][0];

                        if(codeSource.slice(0,code.length) == code)
                            position = i+1;                            
                    };

                    if(!lastCode)lastCode = data[1]+'00';
                }
                else{
                    let data = sourceData.filter(c=>{
                        let code = c[0].replace(this.idVisi,'');

                        if(code.length == 2)return c;
                    });
                    lastCode = data[data.length-1][0];
                    position = sourceData.length;
                }

                let newDigits = ("0" +(parseInt(lastCode.slice(-2))+1)).slice(-2);
                let newCode = lastCode.slice(0,-2) + newDigits; 
                let capitalize = data[0].charAt(0).toUpperCase() + data[0].slice(1);               
                data=[newCode,capitalize,data[2]];
                break;
            }
            case 'rpjm':{

            }
        }

        if(position != 0){
            this.activeHot.alter("insert_row", position);
            this.activeHot.populateFromArray(position, 0, [data], position, 3, null, 'overwrite');
        }        
    }

    openAddRowDialog(){    
        let type = this.activeSheet.match(/[a-z]+/g)[0];
        switch(type){
            case 'renstra':
                let category = 'misi'
                let selected = this.activeHot.getSelected();                

                if(selected){
                    let data = this.activeHot.getDataAtRow(selected[0]);
                    let code = data[0].replace(this.idVisi,'');
                    let currents = categories.filter(c=>c.category=='renstra')[0].currents;
                    let current = currents.filter(c=>c.lengthId==code.length+2)[0];

                    if(!current) current = currents.filter(c=>c.lengthId ==6)[0];
                    category = current.fieldName.split('_')[1].toLowerCase();
                }
                this.zone.run(()=>{
                    this.categorySelected = category;
                    $("#modal-add-"+type).modal("show"); 
                    $('input[name=category][value='+category+']').checked = true;                    
                });    

                if(category!== 'misi')this.categoryOnChange(category);
                break;       
        }           
    }

    addOneRow(): void{
        let type = this.activeSheet.match(/[a-z]+/g)[0]
        this.addRow();
        $("#modal-add-"+type).modal("hide");
        $('#form-add-'+type)[0].reset();
       
    }

    addOneRowAndAnother():void{        
        this.addRow();
        this.contentSelectMisi=[];
        this.contentSelection=[];    
        this.categoryOnChange(this.categorySelected); 
    }

    categoryOnChange(value){
        let sourceData = this.activeHot.getSourceData()
        switch(value){
            case 'tujuan':
                 this.contentSelection =  sourceData.filter(c=>{
                    let code = c[0].replace(this.idVisi,'');

                    if(code.length == 2)return c;
                 });
                 this.contentSelectMisi=[];
                 break;
            
            case 'sasaran':
                this.contentSelection = [];
                this.contentSelectMisi = sourceData.filter(c=>{
                    let code = c[0].replace(this.idVisi,'');

                    if(code.length == 2)return c;
                 });
                break;
            
            default:
                this.contentSelection = [];
                this.contentSelectMisi =[];
                break;
            
        }
    } 

    selectedOnChange($event){
        let value =  $event.target.value.replace(this.idVisi,'');
        let sourceData = this.activeHot.getSourceData();
        this.contentSelection=[];
        sourceData.forEach(data=>{
            let code = data[0].replace(this.idVisi,'');
            if(code.length == 4 && code.slice(0,2)==value)
                this.contentSelection.push(data);
        })        
    }     

    arrayToObj(arr, schema) {
        let result = {};
        for (var i = 0; i < schema.length; i++)
            result[schema[i]] = arr[i];
        return result;
    }   

    bundleData(bundleDiff){   
        let tables=['Ta_RPJM_Misi','Ta_RPJM_Tujuan','Ta_RPJM_Sasaran'];
        let expandCol = {Kd_Desa:this.regionCode}     
        let bundleData ={
            insert:[],
            update:[],
            deleted:[]
        };    
        //table:ta,data:apa:where:ta:123
        
        bundleDiff.added.forEach(content => { 
            let result = this.bundleArrToObj(content); 
            let bundle = bundleData.insert[result.table];

            Object.assign(result.data,expandCol)
            bundleData.insert.push({[result.table]:result.data})
        }); 
        
        bundleDiff.modified.forEach(content => {    
            let result = this.bundleArrToObj(content); 
            let bundle = bundleData.insert[result.table];

            let field = categories[0].fields.filter(c=>c[1]==content[1])[0];        
            let data = this.arrayToObj(content.slice(0,field.length),field);

                                 

        });     
        return bundleData;
    }   

    bundleArrToObj(content){
        enum Tables {Ta_RPJM_Misi=2,Ta_RPJM_Tujuan=4,Ta_RPJM_Sasaran=6};

        let result = {};
        let code = content[0].substring(this.idVisi.length);   
        let table = Tables[code.length]; 
        let field = categories[0].fields.filter(c=>c[1]==content[1])[0];        
        let data = this.arrayToObj(content.slice(0,field.length),field); 

        result = Object.assign(data,this.partCode(content[0]));      

        return {table:table,data:result}
    }    

    sliceObject(obj,values){
        let res = {};
        let keys = Object.keys(obj);

        for(let i=0;i<keys.length;i++){
            if(values.indexOf(keys[i]) !== -1) continue;
            res[keys[i]] = obj[keys[i]]
        }
        return res;
    }

    partCode(codeSource){

        let fields = ['ID_Visi','ID_Misi','ID_Tujuan','ID_Sasaran'];
        let code = codeSource.substring(this.idVisi.length);
        let type = Types[code.length];
        
        let posField = fields.indexOf('ID_'+type)
        let results = {};

        fields.slice(posField-1,posField+1).forEach(field=>{
            let endSlice = Types[field.split('_')[1]]
            results[field] = this.idVisi + code.slice(0,parseInt(endSlice))
        })

        results['No_'+type] = code.slice(-2)
        return results;
        
    }
}

class Renstra{
    constructor(){

    }
}



