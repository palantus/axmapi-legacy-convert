let fetch = require("node-fetch")
let System = require("./lib/service")
let Entity = require("entitystorage")
const fs = require('fs');
const setup = JSON.parse(fs.readFileSync('./setup.json',{encoding:'utf8', flag:'r'}));

let convert = async () => {

    if(setup.starterUrl){
      console.log("Stopping api service")
      await fetch(`${setup.starterUrl}/api/disableService/axmanapi`)
    }

    console.log("Deleting current database")
    try{require("fs").unlinkSync(`${setup.destination}/props.data`)}catch(err){}
    try{require("fs").unlinkSync(`${setup.destination}/rels.data`)}catch(err){}
    try{require("fs").unlinkSync(`${setup.destination}/tags.data`)}catch(err){}

    console.log("Initializing entity")
    await Entity.init(setup.destination)
    
    console.log("Converting data")
    await new System(setup).convert()

    if(setup.starterUrl){
      console.log("Starting service again")
      await fetch(`${setup.starterUrl}/api/enableService/axmanapi`)
    }
}

convert()