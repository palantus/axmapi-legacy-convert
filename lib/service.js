"use strict"
let Entity = require("entitystorage")
let fetch = require("node-fetch")

class SysService{
    constructor(setup){
      this.setup = setup
    }

    async convert(){
        //Users
        (await this.get("user/all")).forEach(u => {
            let user = new Entity()
            user.id = u.UserId
            user.name = u.Name
            user.tag(u.Obsolete ? "obsolete" : null)
            user.tag("user")
            if(u.VSTSUserId){
              new Entity()
                      .prop("id", "")
                      .prop("email", u.Email ? u.Email : `${u.UserId}@${this.setup.tenant}`)
                      .prop("name", u.ForumName || u.Name)
                      .tag("msuser")
                      .rel(user, "user")
            }
            if(/*u.UserId == "axman" || */u.UserId == "vsts" || u.UserId == "nav"){
                user.tag("virtual")
            }
        });

        //Sprints
        (await this.get("iterations/all")).forEach(r => {
          new Entity()
                .tag("sprint")
                .prop("id", parseInt(r.Title == "Opstartssprint" ? 0 : /\d+/.exec(r.Title)))
                .prop("startDate", r.StartDate.substr(0, 10))
                .prop("endDate", r.EndDate.substr(0, 10))
                .prop("title", r.Title)
        });
        

        //Releases
        (await this.get("releases/all")).forEach(r => {
          let rId = parseInt(/\d+/.exec(r.Id))
          new Entity()
                .tag("release")
                .prop("id", rId)
                .prop("shortName", rId < 51 ? `HF${rId}` : `R${rId}`)
                .prop("title", (typeof r.Description === "string" && r.Description.length > 0) ? r.Description : rId < 51 ? "Hotfix " + rId : "Release " + rId)
                .prop("releasedate", r.ReleaseDate ? r.ReleaseDate.split('-').reverse().join('-') : "")
                .tag(r.ReleasedDisplay !== "" ? "released" : null)
        });
        

        //Hotfix
        (await this.get("hotfix/all")).forEach(r => {
          let rel = Entity.find(`tag:release prop:"id=${/\d+/.exec(r.Hotfix)}"`)
          if(rel)
              return;
                
          let rId = parseInt(/\d+/.exec(r.Hotfix))
          new Entity()
                .tag("release")
                .prop("id", rId)
                .prop("shortName", rId < 51 ? `HF${rId}` : `R${rId}`)
                .prop("title", (typeof r.Description === "string" && r.Description.length > 0) ? r.Description : rId < 51 ? "Hotfix " + rId : "Release " + rId)
                .prop("releasedate", r.ReleaseDate ? r.ReleaseDate : "")
                .tag("released")
        });
        
        //Assignments
        (await this.get("assignment/search/:open|!:open/false/true/true")).forEach(a => {
            let aNew = new Entity()
                .tag("issue")
                .prop("title", a.Title)
                .prop("id", a.VSTSID)
                .prop("priority", a.Priority || 0)
                .prop("storypoints", a.StoryPoints || 0)
                .prop("legacyid", a.AssignmentNum)
                .prop("createddate", a.CreatedDate || null)
                .prop("closeddate", a.ClosedDate || null)
                .prop("description", a.Description || "")
                .prop("stackrank", a.StackRank || 0)
                .tag(a.Tags ? a.Tags.split(",").map(t => "user-"+t) : null)
                .tag(a.Status >= 80 ? "closed" : null)
                .tag(a.Relevant50 ? "2009" : null)
                .tag(a.Relevant60 ? "2012" : null)
                .tag(a.Relevant70 ? "D365" : null)

            switch(a.Type){
                case "Bug": aNew.type = "bug"; break;
                case "User Story": aNew.type = "story"; break;
                case "Feature": aNew.type = "feature"; break;
                case "Epic": aNew.type = "epic"; break;
                default: aNew.type = ""
            }

            if(a.IterationPath){
                let sId = /\d+/.exec(a.IterationPath)
                let sprint = Entity.find(`tag:sprint prop:"id=${sId}"`)
                if(sprint){
                    aNew.rel(sprint, "sprint")
                }
            }

            if(a.Release){
                let release = Entity.find(`tag:release prop:"id=${/\d+/.exec(a.Release)}"`)
                if(!release){
                    let rId = parseInt(/\d+/.exec(a.Release))
                    release = new Entity()
                          .tag("release")
                          .prop("id", rId)
                          .prop("shortName", rId < 51 ? `HF${rId}` : `R${rId}`)
                          .prop("title", rId < 51 ? "Hotfix " + rId : "Release " + rId)
                          .tag("released")
                }
                aNew.rel(release, "release")
            } else if(a.Hotfix){
                let release = Entity.find(`tag:release prop:"id=${/\d+/.exec(a.Hotfix)}"`)
                if(!release){
                    let rId = parseInt(/\d+/.exec(a.Hotfix))
                    release = new Entity()
                          .tag("release")
                          .prop("id", rId)
                          .prop("shortName", `HF${a.Hotfix}`)
                          .prop("title", `HF${a.Hotfix}`)
                          .tag("released")
                }
                aNew.rel(release, "release")
            }

            // Tasks
            a.Tasks.forEach(t => {
                let nt = new Entity()
                nt.tag("task")
                nt.title = t.Title || "New task"
                nt.id = t.Id
                nt.assignee = t.AssignedTo
                nt.remainingHours = t.RemainingHours
                nt.completedHours = t.CompletedHours
                nt.originalHours = t.OriginalHours
                nt.tag(t.Status >= 80 ? "closed" : null)
                nt.stackrank = t.StackRank
                nt.rel(aNew, "issue")
            })

            // Elements
            a.Elements.forEach(t => {
                let element = Entity.find(`tag:element prop:"type=${t.Type}" prop:"name=${t.Name}"`)
                if(!element){
                    try{
                        element = new Entity(t.Type, t.Name)
                        .tag("element")
                        .prop("type", t.Type)
                        .prop("name", t.Name)
                    } catch(err){
                        console.log(aNew.id)
                        console.log(t)
                        throw "ERROR"
                    }
                }
                element.rel(aNew, "issue")
            })
        });

        // Servers
        let servers = await this.get("server/all")
        for(let r of servers){
            new Entity().tag("server").prop("id", r.Name).prop("location", "internal")
        }
        new Entity().tag("server").prop("id", "ahkdev10").prop("location", "external")
        new Entity().tag("server").prop("id", "ahkdevhp").prop("location", "external")
        new Entity().tag("server").prop("id", "myidev").prop("location", "external")

        let serversAzure = await this.get("azure/vms")
        for(let r of serversAzure){
            new Entity().tag("server").prop("id", r.name).prop("location", "azure")
        }        

        //Instances
        let instances = await this.get("instance/all")
        for(let r of instances){
            let v = "";
            switch(r.AxVersion){
                case 4: v = "2009"; break;
                case 10: v = "2012"; break;
                case 11: v = "D365"; break;
            }
            let instance = new Entity().tag("instance").prop("id", r.Name).prop("axVersion", v)
                            //.prop("server", r.PhysicalServerName)

            let instanceServer = Entity.find(`tag:server prop:"id=${r.PhysicalServerName}"`)
            if(instanceServer)
              instance.rel(instanceServer, "server")
            else
              console.error(`Server missing for instance ${r.Name}`)

            // Companies
            let companies = await this.get("instance/companies/" + r.Name)
            for(let company of companies)
                new Entity()
                    .tag("company")
                    .prop("id", company.Company)
                    .prop("title", company.Name)
                    .prop("country", company.Country)
                    .prop("employeeCount", company.NumEmployees)
                    .prop("firstAccess", company.FirstAccess)
                    .prop("lastAccess", company.LastAccess)
                    .prop("firstAccessedBy", company.FirstAccessedBy)
                    .prop("accessedBy", company.AccessedBy)
                    .prop("lastAccessedBy", company.LastAccessedBy)
                    .prop("owner", company.Owner)
                    .rel(instance, "instance")
        }

        
        // Runbook actions
        let actions = await this.get("runbooks/actions")
        for(let a of actions){
            let type = new Entity()
                        .tag("actiontype")
                        .prop("name", a.Name)
                        .prop("title", a.Title)
                        .prop("contextType", a.ContextType||"none")
                        .prop("timeout", a.TimeoutSeconds||60)

            for(let p of a.parms){
              let parm = new Entity().tag("actiontypeparm")
                  .prop("name", p.Name)
                  .prop("title", p.Title)
                  .prop("type", p.Type)

              type.rel(parm, "parm")
            }
        }

        // System configuration
        let sys = Entity.findOrCreate(`tag:system`).tag("system");
        let flags = Entity.find("tag:systemFlags") || new Entity().tag("systemFlags")
        flags.tasks = true;

        if(this.setup.azureClientId){
          sys.azureClientId = this.setup.azureClientId;
          sys.azureTenant = this.setup.azureTenant;
          sys.azureSecret = this.setup.azureSecret;
          sys.azureSubscriptionId = this.setup.azureSubscriptionId;
          flags.azure = true;
        }

        if(this.setup.relayKey){
          flags.relay = true
          sys.relayURL = this.setup.relayURL;
          sys.relayUserId = this.setup.relayUserId;
          sys.relayKey = this.setup.relayKey;
        }

        // API keys
        if(this.setup.actionClientsKey){
          new Entity().tag("apikey")
                      .prop("name", "actionclients")
                      .prop("user", "axman")
                      .prop("key", this.setup.actionClientsKey)
        }

        return true;
    }

    async get(api){
        return (await (await fetch(`${this.setup.apiUrl}/api/${api}?accessKey=${this.setup.accessKey}`)).json()).result;
    }
}

module.exports = SysService