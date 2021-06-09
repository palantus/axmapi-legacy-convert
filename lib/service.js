"use strict"
let Entity = require("entitystorage")
let fetch = require("node-fetch")

class SysService{
  constructor(setup){
    this.setup = setup
  }

  async convert(modules){
    if(Array.isArray(modules) && modules.length > 0){
      for(let mod of modules){
        const functionName = `convert${mod.charAt(0).toUpperCase()}${mod.slice(1)}`
        if(typeof this[functionName] === "function"){
          await this[functionName].apply(this)
        } else {
          throw `Unknown module ${mod}`
        }
      }
      console.log("Finished")
      return;
    }
    console.log("Converting ALL modules")
    Promise.all([this.convertUsers(),
                 this.convertSprints(),
                 this.convertReleases(),
                 this.convertTags()])
            .then(() => {
              this.convertAssignments();
            })
    this.convertServers().then(() => {
      this.convertInstances().then(() => {
        this.convertCompanies();
      })
    });
    this.convertLabels();
    this.convertSystem();
    this.convertForum();
    this.convertRunbook();
  }

  async convertUsers(){
      Entity.search("tag:user|tag:msuser").delete();

      console.log("Converting users");
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
  }
  async convertSprints(){
    Entity.search("tag:sprint").delete();
    
    console.log("Converting sprints");
    (await this.get("iterations/all")).forEach(r => {
      new Entity()
            .tag("sprint")
            .prop("id", parseInt(r.Title == "Opstartssprint" ? 0 : /\d+/.exec(r.Title)))
            .prop("startDate", r.StartDate.substr(0, 10))
            .prop("endDate", r.EndDate.substr(0, 10))
            .prop("title", r.Title)
    });
  }
  
  async convertReleases(){
    console.log("Converting releases");

    Entity.search("tag:release").delete();

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

    console.log("Converting hotfixes");

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

  }
  async convertTags(){
      console.log("Converting tags");
      Entity.search("tag:tag").delete();

      let tags = await this.get("tags/all")
      for(let t of tags){
        let tag = Entity.find(`tag:tag prop:"id=${t.tag}"`)
        if(!tag){
          new Entity().tag("tag")
                      .prop("id", t.tag)
                      .prop("hideInGrids", t.hideInGrids)
                      .prop("minorDetail", t.minorDetail)
                      .prop("groupByInManuals", t.groupByInManuals)
                      .prop("excludeInReleaseNotes", t.excludeInReleaseNotes)
                      .prop("textInManuals", t.textInManuals)
        }
      }
        
  }
  async convertAssignments(){
        console.log("Converting assignments");
        Entity.search("tag:issue|tag:task|tag:element").delete();
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

            for(let t of a.Tags?.split(",")||[]){
              aNew.rel(Entity.find(`tag:tag prop:"id=${t}"`), "tag")
            }

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

  }
  async convertServers(){
        console.log("Converting servers");
        Entity.search("tag:server").delete();
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

  }
  async convertInstances(){
        console.log("Converting instances");
        Entity.search("tag:instance|tag:company").delete();
        let instances = await this.get("instance/all")
        for(let r of instances){
            let v = "";
            switch(r.AxVersion){
                case 4: v = "2009"; break;
                case 10: v = "2012"; break;
                case 11: v = "D365"; break;
            }
            let instance = new Entity().tag("instance")
                                       .prop("id", r.Name)
                                       .prop("axVersion", v)
                                       .prop("databaseName", r.DBName)
                                       .prop("clientPath", r.ClientPath)
                                       .prop("devLayer", r.DevelopLayer)
                                       .prop("configName", r.ConfigName)
                                       .prop("devLayerCode", r.DevelopLayerCode)
                                       .tag(r.Obsolete == 1 ? "obsolete" : null)
                                       .prop("buildNo", r.VersionBuildNo)
                                       .prop("url", r.URL)
                                       .prop("databaseServerName", r.DBServerName)
                                       .prop("wsdlPort", r.WSDLPort)

            let instanceServer = Entity.find(`tag:server prop:"id=${r.PhysicalServerName}"`)
            if(instanceServer)
              instance.rel(instanceServer, "server")
            else
              console.error(`Server missing for instance ${r.Name}`)
        }
  }

  async convertCompanies(){
    console.log("Converting companies");
    Entity.search("tag:company").delete();

    // Companies
    for(let instance of Entity.search("tag:instance")){
      let companies = await this.get("instance/companies/" + instance.id)
      for(let company of companies){
          let c = new Entity()
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
    }

    let heartbeats = await this.get("instance/latestHeartbeats")
    for(let hb of heartbeats){
      let user = Entity.find(`tag:user prop:id=${hb.UserId}`)
      if(!user) continue;
      let company = Entity.find(`tag:company instance.prop:"id=${hb.InstanceName}" prop:"id=${hb.Company}"`)
      if(!company) continue;
      new Entity().tag("heartbeat").rel(company, "company").rel(user, "user").prop("date", hb.Timestamp.substr(0, 10))
    }
  }

  async convertRunbook(){
        // Runbook actions
        console.log("Converting actions");
        Entity.search("tag:actiontype|tag:actiontypeparm").delete();
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

  }
  async convertLabels(){
        // Labels
        console.log("Converting labels");
        Entity.search("tag:label|tag:labellogentry").delete();
        let labels = await this.get("labels/all/true/true/true/true/true")
        for(let label of labels.reverse()){
          let lbl = new Entity().tag("label")
          lbl.id = label.Id
          lbl.module = label.Module
          lbl.version = label.Version
          lbl.usage = label.Usage
          lbl.definition = label.Definition
          lbl.textDA = label.TextDA
          lbl.textEN = label.TextEN
          lbl.textNO = label.TextNO
          lbl.code = label.Code
        }

        // Label log
        let logentries = await this.get("labels/log")
        for(let entry of logentries){
          let e = new Entity().tag("labellogentry")
          e.labelId = entry.LabelId
          e.timestamp = entry.Timestamp
          e.userId = entry.UserId
          e.field = entry.Field
          e.type = entry.Type
          e.valueFrom = entry.ValueFrom
          e.valueTo = entry.ValueTo
        }

  }
  async convertSystem(){
        // System configuration
        console.log("Converting system");
        Entity.search("tag:system|tag:apikey").delete();
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

  }
  
  async convertForum(){
        console.log("Converting forums");
        Entity.search("tag:forum|tag:forumthread|tag:forumpost").delete();
        for(let f of await this.get("forum/forums")){
          new Entity().tag("forum")
                      .prop("forum", f.ForumId)
                      .prop("name", f.Name)
                      .prop("product", f.Product)
        }

        console.log("Converting threads");
        let threads = await this.get("forum/threads")
        for(let thread of threads){
          let t = new Entity().tag("forumthread")
                    .prop("id", thread.ThreadId)
                    .prop("forum", thread.ForumId)
                    .prop("title", thread.Title)
                    //.prop("numreplies", thread.NumReplies)
                    .prop("date", new Date(thread.PostedDate).toISOString().slice(0, -1))
                    .prop("author", thread.Author)
                    .prop("title", thread.Title)
                    .prop("url", `${this.setup.forumThreadLink}${thread.ThreadId}`)
                    .tag(thread.CaseClosed ? "closed" : null)
                    .rel(Entity.find(`tag:forum prop:forum=${thread.ForumId}`), "forum")
        }

        let chunkSize = 100;
        let threadIdsAll = threads.map(t => t.ThreadId)
        for (let i = 0, j = threadIdsAll.length; i < j; i += chunkSize) {
          console.log(`Converting forum post chunk ${Math.floor(i/chunkSize)+1}/${Math.ceil(j/chunkSize)+1}`);
          let threadSet = threadIdsAll.slice(i, i + chunkSize);
          let posts = await this.get(`forum/posts/[${threadSet.join(",")}]`)
          for(let p of posts){
            new Entity().tag("forumpost")
                    .prop("id", p.PostId)
                    .prop("thread", p.ThreadId)
                    .prop("body", p.Body)
                    .prop("subject", p.Subject)
                    .prop("date", new Date(p.PostedDate).toISOString().slice(0, -1))
                    .prop("author", p.Author)
                    .rel(Entity.find(`tag:forumthread prop:id=${p.ThreadId}`), "thread")
          }
        }
    }

    async get(api){
        return (await (await fetch(`${this.setup.apiUrl}/api/${api}?accessKey=${this.setup.accessKey}`)).json()).result;
    }
}

module.exports = SysService