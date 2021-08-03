"use strict"
let Entity = require("entitystorage")
let fetch = require("node-fetch")

class SysService {
  constructor(setup) {
    this.setup = setup
  }

  async convert(modules) {
    if (Array.isArray(modules) && modules.length > 0) {
      for (let mod of modules) {
        const functionName = `convert${mod.charAt(0).toUpperCase()}${mod.slice(1)}`
        if (typeof this[functionName] === "function") {
          await this[functionName].apply(this)
        } else {
          throw `Unknown module ${mod}`
        }
      }
      console.log("Finished")
      return;
    }
    console.log("Converting ALL modules")
    Promise.all([
      this.convertUsers(),
      this.convertSprints(),
      this.convertReleases(),
      this.convertTags(),
      this.convertElementTypes(),
      this.convertModels(),
      this.convertMinifix()
    ]).then(() => {
      this.convertAssignments().then(() => {
        Promise.all([
          this.convertChangesets(),
          this.convertElementModels()
        ]).then(() => {
          this.convertChangelog();
        })
      })
    })
    this.convertServers().then(() => {
      this.convertInstances().then(() => {
        //this.convertCompanies(); //Skipped because it is maintained on new version
      })
    });
    this.convertLabels();
    this.convertSystem();
    this.convertForum();
    this.convertRunbook();
  }

  async convertUsers() {
    console.log("Converting users");
    (await this.get("user/all")).forEach(u => {
      let user = Entity.find(`tag:user prop:id=${u.UserId}`)
      if (!user) {
        user = new Entity()
        user.id = u.UserId
        user.tag("user")
      }
      user.name = u.Name
      user.tag(u.Obsolete ? "obsolete" : null)
      user.tag(u.IsDeveloper ? "developer" : null)
      user.tag(u.IsTester ? "tester" : null)
      user.forumName = u.ForumName
      user.vstsUserId = u.VSTSUserId
      user.email = u.Email

      if (u.VSTSUserId) {
        let email = u.Email ? u.Email : `${u.UserId}@${this.setup.tenant}`
        let msUser = Entity.find(`tag:msuser prop:"email=${email}"`)
        if (!msUser) {
          msUser = new Entity()
            .prop("id", "")
            .prop("email", email)
            .prop("name", u.ForumName || u.Name)
            .tag("msuser")
            .rel(user, "user")
        }

        msUser = Entity.find(`tag:msuser prop:"email=${u.VSTSUserId}"`)
        if (!msUser) {
          msUser = new Entity()
            .prop("id", "")
            .prop("email", u.VSTSUserId)
            .prop("name", u.ForumName || u.Name)
            .tag("msuser")
            .rel(user, "user")
        }
      }
      if (/*u.UserId == "axman" || */u.UserId == "vsts" || u.UserId == "nav") {
        user.tag("virtual")
      }
    });
  }
  async convertSprints() {
    console.log("Converting sprints");
    (await this.get("iterations/all")).forEach(r => {
      let id = parseInt(r.Title == "Opstartssprint" ? 0 : /\d+/.exec(r.Title))
      let sprint = Entity.find(`tag:sprint prop:id=${id}`)
      if (!sprint) {
        new Entity().tag("sprint")
          .prop("id", id)
          .prop("startDate", r.StartDate.substr(0, 10))
          .prop("endDate", r.EndDate.substr(0, 10))
          .prop("title", r.Title)
      }
    });
  }

  async convertReleases() {
    console.log("Converting releases");

    (await this.get("releases/all")).forEach(r => {
      let rId = parseInt(/\d+/.exec(r.Id))
      let release = Entity.find(`tag:release prop:id=${rId}`)
      if (!release) {
        release = new Entity()
          .tag("release")
          .prop("id", rId)
          .prop("shortName", rId < 51 ? `HF${rId}` : `R${rId}`)
          .prop("title", (typeof r.Description === "string" && r.Description.length > 0) ? r.Description : rId < 51 ? "Hotfix " + rId : "Release " + rId)
      }

      release.prop("releasedate", r.ReleaseDate ? r.ReleaseDate.split('-').reverse().join('-') : "")
        .tag(r.ReleasedDisplay !== "" ? "released" : null)
    });

    console.log("Converting hotfixes");

    (await this.get("hotfix/all")).forEach(r => {
      let rel = Entity.find(`tag:release prop:"id=${/\d+/.exec(r.Hotfix)}"`)
      if (rel)
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
  async convertTags() {
    console.log("Converting tags");
    let tags = await this.get("tags/all")
    for (let t of tags) {
      let tag = Entity.find(`tag:tag prop:"id=${t.tag}"`)
      if (!tag) {
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
  
  async convertAssignments() {
    console.log("Converting assignments");
    (await this.get("assignment/search/:open|!:open/false/true/true")).forEach(a => {
      let tags = a.Tags?.split(",") || [];
      if(tags.includes("SlettetVSTS")) return; // Don't recreate deleted issues
      
      let aNew = Entity.find(`tag:issue prop:"id=${a.VSTSID}"`)
              || new Entity().tag("issue").prop("id", a.VSTSID)

      aNew.prop("title", a.Title)
        .prop("priority", a.Priority || 0)
        .prop("storypoints", a.StoryPoints || 0)
        .prop("legacyid", a.AssignmentNum)
        .prop("createddate", a.CreatedDate || null)
        .prop("closeddate", a.ClosedDate || null)
        .prop("description", a.Description || "")
        .prop("stackrank", a.StackRank || 0)
        .prop("descriptionChanges", a.DescriptionChanges||null)
        .prop("descriptionRelease", a.DescriptionHotfix||null)
        .prop("releaseNoteTag", a.ReleaseNoteTag||null)

      aNew.tags.filter(t => t.startsWith("user-")).forEach(t => aNew.removeTag(t));
      aNew.rels.tag?.filter(t => !tags.includes(t.id)).forEach(t => aNew.removeRel(t, "tag"));
      a.Tags?.split(",").filter(tag => aNew.rels.tag?.find(t => t.id == tag) ? false : true).map(tag => Entity.find(`tag:tag prop:"id=${tag}"`)).forEach(t => aNew.rel(t, "tag"))

      if (a.Status >= 80) aNew.tag("closed"); else aNew.removeTag("closed");
      if (a.Relevant50) aNew.tag("2009"); else aNew.removeTag("2009");
      if (a.Relevant60) aNew.tag("2012"); else aNew.removeTag("2012");
      if (a.Relevant70) aNew.tag("D365"); else aNew.removeTag("D365");

      switch (a.Type) {
        case "Bug": aNew.type = "bug"; break;
        case "User Story": aNew.type = "story"; break;
        case "Feature": aNew.type = "feature"; break;
        case "Epic": aNew.type = "epic"; break;
        default: aNew.type = ""
      }

      if (a.IterationPath) {
        let sId = /\d+/.exec(a.IterationPath)
        let sprint = Entity.find(`tag:sprint prop:"id=${sId}"`)
        if (sprint) {
          aNew.rel(sprint, "sprint")
        }
      }

      if (a.Release) {
        let release = Entity.find(`tag:release prop:"id=${/\d+/.exec(a.Release)}"`)
        if (!release) {
          let rId = parseInt(/\d+/.exec(a.Release))
          release = new Entity()
            .tag("release")
            .prop("id", rId)
            .prop("shortName", rId < 51 ? `HF${rId}` : `R${rId}`)
            .prop("title", rId < 51 ? "Hotfix " + rId : "Release " + rId)
            .tag("released")
        }
        aNew.rel(release, "release")
      } else if (a.Hotfix) {
        let release = Entity.find(`tag:release prop:"id=${/\d+/.exec(a.Hotfix)}"`)
        if (!release) {
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
        let nt = Entity.find(`tag:task prop:"id=${t.Id}"`)
        if (!nt) {
          nt = new Entity()
          nt.id = t.Id
          nt.tag("task")
        }
        nt.title = t.Title || "New task"

        nt.removeProp("assignee")
        if(t.AssignedTo){
          nt.rel(Entity.find(`tag:user prop:"id=${t.AssignedTo}"`), "assignee")
        }

        nt.remainingHours = t.RemainingHours
        nt.completedHours = t.CompletedHours
        nt.originalHours = t.OriginalHours
        if (t.Status >= 80) nt.tag("closed"); else nt.removeTag("closed");
        nt.stackrank = t.StackRank
        //nt.rel(aNew, "issue")
        nt.removeRel(aNew, "issue")
        aNew.rel(nt, "task")
      })

      // Elements
      a.Elements.forEach(t => {
        let type = Entity.find(`tag:elementtype (prop:"id=${t.Type}"|prop:"vstsName=${t.Type}")`)
        if(!type){
          console.log("Missing type for element ", t)
          return;
        }
        let element = Entity.find(`tag:element type.id:${type} prop:"name=${t.Name}"`)
        if (!element) {
          element = new Entity()
            .tag("element")
            .prop("name", t.Name)
            .rel(type, "type")
        }
        element.rels.issue?.forEach(e => element.removeRel(e, "issue"));
        aNew.rel(element, "element")
      })

      // Comments
      a.Comments.forEach(t => {
        let nt = Entity.find(`tag:comment comment..id:${aNew} (prop:"vstsRevision=${t.VSTSRevision}"|prop:"legacyId=${t.Id}")`)
        if (!nt) {
          nt = new Entity()
          nt.legacyId = t.Id
          nt.tag("comment")
        }
        nt.timestamp = t.PostedDateTime.substr(0, 19)
        let user = Entity.find(`tag:user prop:id=${t.UserId}`)
        if (user) nt.rel(user, "user")
        else console.log(`Comment ${t.Id} doesn't have a user. UserId: ${t.UserId}`);
        nt.text = t.Comment
        nt.vstsRevision = t.VSTSRevision || null
        aNew.rel(nt, "comment")
      })

      // Relations
      a.Relations.forEach(r => {

        switch(r.Type){
          case "Assignment":
            aNew.rel(Entity.find(`tag:issue prop:"legacyid=${r.Id}"`)?.rel(aNew, "related"), "related")
            break;
          case "ForumThread":
            Entity.find(`tag:forumthread prop:"id=${r.Id}"`)?.rel(aNew, "issue")
            break;

          case "changeset":
            break; //Ignore

          case "Minifix":
            //TODO: Handle
            break;

          default:
            //console.log(`Unhandled issue relation type: ${r.Type}`)
        }
      })
    });
  }

  async convertServers() {
    console.log("Converting servers");
    let servers = await this.get("server/all")
    for (let r of servers) {
      Entity.findOrCreate(`tag:server prop:"id=${r.Name}"`).tag("server").prop("id", r.Name).prop("location", "internal")
    }
    Entity.findOrCreate("tag:server prop:id=ahkdev10").tag("server").prop("id", "ahkdev10").prop("location", "external")
    Entity.findOrCreate("tag:server prop:id=ahkdevhp").tag("server").prop("id", "ahkdevhp").prop("location", "external")
    Entity.findOrCreate("tag:server prop:id=myidev").tag("server").prop("id", "myidev").prop("location", "external")

    let serversAzure = await this.get("azure/vms")
    for (let r of serversAzure) {
      Entity.findOrCreate(`tag:server prop:"id=${r.name}"`).tag("server").prop("id", r.name).prop("location", "azure")
    }
  }

  async convertInstances() {
    console.log("Converting instances");

    let instances = await this.get("instance/all")
    for (let r of instances) {
      let v = "";
      switch (r.AxVersion) {
        case 4: v = "2009"; break;
        case 10: v = "2012"; break;
        case 11: v = "D365"; break;
      }

      let instance = Entity.find(`tag:instance prop:"id=${r.Name}"`)
      if (!instance) {
        instance = new Entity().tag("instance")
          .prop("id", r.Name)
      }
      instance.prop("axVersion", v)
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
      if (instanceServer)
        instance.rel(instanceServer, "server")
      else
        console.error(`Server missing for instance ${r.Name}`)
    }
  }

  async convertCompanies() {
    console.log("Converting companies");

    // Companies
    for (let instance of Entity.search("tag:instance")) {
      let companies = await this.get("instance/companies/" + instance.id)
      for (let company of companies) {
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
    for (let hb of heartbeats) {
      let user = Entity.find(`tag:user prop:id=${hb.UserId}`)
      if (!user) continue;
      let company = Entity.find(`tag:company instance.prop:"id=${hb.InstanceName}" prop:"id=${hb.Company}"`)
      if (!company) continue;
      new Entity().tag("heartbeat").rel(company, "company").rel(user, "user").prop("date", hb.Timestamp.substr(0, 10))
    }
  }

  async convertRunbook() {
    // Runbook actions
    console.log("Converting actions");
    let actions = await this.get("runbooks/actions")
    for (let a of actions) {
      let type = Entity.find(`tag:actiontype prop:"name=${a.Name}"`)
      if (!type) {
        type = new Entity()
          .tag("actiontype")
          .prop("name", a.Name)
          .prop("contextType", a.ContextType || "none")
          .prop("timeout", a.TimeoutSeconds || 60)
          .prop("title", a.Title)
      }

      for (let p of a.parms) {
        let parm = Entity.find(`tag:actiontypeparm prop:"name=${p.Name}" parm..prop:"name=${a.Name}"`)
        if (!parm) {
          parm = new Entity().tag("actiontypeparm")
            .prop("name", p.Name)
            .prop("title", p.Title)
            .prop("type", p.Type)
          type.rel(parm, "parm")
        }
      }
    }
  }

  async convertLabels() {
    // Labels
    console.log("Converting labels");

    let labels = await this.get("labels/all/true/true/true/true/true")
    for (let label of labels.reverse()) {
      let lbl = Entity.find(`tag:label prop:"id=${label.Id}"`)
      if (!lbl) {
        lbl = new Entity().tag("label")
        lbl.id = label.Id
      }
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
    for (let entry of logentries) {
      let e = Entity.find(`tag:labellogentry prop:"labelId=${entry.LabelId}" prop:"timestamp=${entry.Timestamp}" prop:"field=${entry.Field}"`)
      if (!e) {
        e = new Entity().tag("labellogentry")
        e.labelId = entry.LabelId
        e.timestamp = entry.Timestamp
        e.userId = entry.UserId
        e.field = entry.Field
        e.type = entry.Type
        e.valueFrom = entry.ValueFrom
        e.valueTo = entry.ValueTo
      }
    }
  }

  async convertSystem() {
    // System configuration
    console.log("Converting system");
    let sys = Entity.findOrCreate(`tag:system`).tag("system");
    let flags = Entity.find("tag:systemFlags") || new Entity().tag("systemFlags")
    flags.tasks = true;

    if (this.setup.azureClientId) {
      sys.azureClientId = this.setup.azureClientId;
      sys.azureTenant = this.setup.azureTenant;
      sys.azureSecret = this.setup.azureSecret;
      sys.azureSubscriptionId = this.setup.azureSubscriptionId;
      flags.azure = true;
    }

    if (this.setup.relayKey) {
      flags.relay = true
      sys.relayURL = this.setup.relayURL;
      sys.relayUserId = this.setup.relayUserId;
      sys.relayKey = this.setup.relayKey;
    }

    // API keys
    if (this.setup.actionClientsKey) {
      if (!Entity.find("tag:apikey prop:name=actionclients")) {
        new Entity().tag("apikey")
          .prop("name", "actionclients")
          .prop("user", "axman")
          .prop("key", this.setup.actionClientsKey)
      }
    }

  }

  async convertForum() {
    console.log("Converting forums");

    for (let f of await this.get("forum/forums")) {
      Entity.findOrCreate(`tag:forum prop:"forum=${f.ForumId}"`)
        .tag("forum")
        .prop("forum", f.ForumId)
        .prop("name", f.Name)
        .prop("product", f.Product)
        .prop("language", f.Language?.toLowerCase() || null)
        .prop("pagecount", f.NumPages)
        .prop("url", f.Link.replace("http://www.lessor.dk/forum", "https://forum.lessor.dk"))
    }

    console.log("Converting threads");
    let threads = await this.get("forum/threads")
    for (let thread of threads) {
      let t = Entity.findOrCreate(`tag:forumthread prop:"id=${thread.ThreadId}"`)
        .tag("forumthread")
        .prop("id", thread.ThreadId)
        .prop("forum", thread.ForumId)
        .prop("title", thread.Title)
        //.prop("numreplies", thread.NumReplies)
        .prop("date", new Date(thread.PostedDate).toISOString().slice(0, -5))
        .prop("author", thread.Author)
        .prop("title", thread.Title)
        .prop("url", `${this.setup.forumThreadLink}${thread.ThreadId}`)
        .tag(thread.CaseClosed ? "closed" : null)
        .rel(Entity.find(`tag:forum prop:forum=${thread.ForumId}`), "forum")

      if (!thread.CaseClosed) t.removeTag("closed")
    }

    let chunkSize = 100;
    let threadIdsAll = threads.map(t => t.ThreadId)
    for (let i = 0, j = threadIdsAll.length; i < j; i += chunkSize) {
      console.log(`Converting forum post chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(j / chunkSize) + 1}`);
      let threadSet = threadIdsAll.slice(i, i + chunkSize);
      let posts = await this.get(`forum/posts/[${threadSet.join(",")}]`)
      for (let p of posts) {
        Entity.findOrCreate(`tag:forumpost prop:"id=${p.PostId}"`)
          .tag("forumpost")
          .prop("id", p.PostId)
          .prop("thread", p.ThreadId)
          .prop("body", p.Body)
          .prop("subject", p.Subject)
          .prop("date", new Date(p.PostedDate).toISOString().slice(0, -5))
          .prop("author", p.Author)
          .rel(Entity.find(`tag:forumthread prop:id=${p.ThreadId}`), "thread")
      }
    }
  }

  async convertModels() {
    console.log("Converting models");
    let modules = await this.get("modules/all")
    for (let m of modules) {
      Entity.findOrCreate(`tag:model prop:"id=${m.ModelName}"`)
        .tag("model")
        .prop("id", m.ModelName)
        .prop("labelFileId", m.LabelFileId)
        .prop("title", m.Description)
        .prop("shortName", m.Id)
    }
  }

  async convertMinifix() {
    console.log("Converting minifix");
    let minifix = await this.get("hotfix/minifix")
    Entity.search("tag:hotfix").forEach(h => h.delete())
    for (let m of minifix) {
      let minifix = Entity.findOrCreate(`tag:hotfix prop:"id=${m.Num}"`)
        .tag("hotfix")
        .prop("id", m.Num)
        .prop("description", m.Description)
        .prop("timestamp", m.PackedDate)
        .prop("version", m.MinorVersionNumber||0)
        
      if(m.Ax50 == 1) minifix.tag("2009")
      if(m.Ax60 == 1) minifix.tag("2012")
      if(m.ForAll == 1) minifix.tag("website")
      if(m.AffectDanish == 1) minifix.tag("DK")
      if(m.AffectNorwegian == 1) minifix.tag("NO")
    }
  }

  async convertElementTypes() {
    console.log("Converting element types");

    let types = await this.get("elements/types")
    for (let t of types.filter(t => t.ShortName ? true : false)) {
      Entity.findOrCreate(`tag:elementtype prop:"id=${t.ShortName}"`)
        .tag("elementtype")
        .prop("id", t.ShortName)
        .prop("vstsName", t.AX7Name)
        .prop("title", t.PrintableName)
        .prop("enumName", t.EnumName)
    }

    Entity.search("tag:element !type.tag:elementtype").forEach(element => {
      let type = Entity.find(`tag:elementtype prop:"id=${element.type}"`)
      if(type){
        element.rel(type, "type")
        element.removeProp("type")
      } else {
        console.log("Missing type for typename " + element.type)
      }
    })
  }

  async convertChangesets(){
    console.log("Converting changesets");
    let changesets = await this.get("changesets/all")
    for (let cs of changesets.filter(c => c.Id >= 1229)) {
      let newCS = Entity.findOrCreate(`tag:changeset prop:"id=${cs.Id}"`)
        .tag("changeset")
        .prop("id", cs.Id)
        .prop("timestamp", cs.Timestamp?.slice(0, -5))
        .prop("comment", cs.Comment)
        .prop("urlAPI", cs.URL)
        .prop("url", cs.URLBrowser)
        .rel(Entity.find(`tag:user prop:id=${cs.UserId}`), "user")

      cs.Assignments?.split(",")?.forEach(a => {
        Entity.find(`tag:issue prop:legacyid=${a}`)?.rel(newCS, "changeset")
      })
      cs.Elements?.split(",")?.forEach(e => {
        let [typeName, name] = e.split(":")
        let type = Entity.find(`tag:elementtype (prop:"vstsName=${typeName}"|prop:"id=${typeName}")`)
        if(type){
          let element = Entity.find(`tag:element type.id:${type} prop:"name=${name}"`)
          if(element){
            newCS.rel(element, "element")
          } else {
            //console.log(`${newCS.id}: Could not find element of type ${typeName} and name ${name}`)
          }
        } else {
          //console.log(`${newCS.id}: Unknown type: ${typeName}`)
        }
      })
    }
  }

  async convertElementModels(){
    console.log("Converting element models");
    let elementModels = await this.get("changesets/elementToModel");

    for(let e of elementModels){
      let type = Entity.find(`tag:elementtype (prop:"vstsName=${e.ElementTypeName}"|prop:"id=${e.ElementTypeName}")`)
      if(type){
        let element = Entity.find(`tag:element type.id:${type} prop:"name=${e.ElementName}"`)
        let model = Entity.find(`tag:model prop:"id=${e.ModelName}"`)
        if(model && element){
          element.rel(model, "model")
        }
      }
    }
  }

  async convertChangelog(){
    console.log("Converting changelog");
    let promises = []
    for(let issue of Entity.search("tag:issue")){
      issue.clearHistory()
      issue.enableHistory()
      if(promises.length > 40){
        await Promise.all(promises)
        promises = []
      }
      if(!issue.legacyid) continue;
      promises.push(this.updateIssueChangelog(issue, this.get(`changelog/search/num:${issue.legacyid}`)))
    }
    await Promise.all(promises)
  }

  async updateIssueChangelog(issue, changelogPromise){
    let changelog = await changelogPromise;

    for(let cle of changelog){
      switch(cle.ChangeType){
        default:
          this.addEntryIfNotExists(issue, {
            type: "legacy", 
            changeTypeName: cle.TypeName, 
            changeTypeTitle: cle.TypeTitle, 
            legacyId: cle.Id, 
            text: cle.ChangeText,
            statusFrom: cle.StatusFromName||undefined, 
            statusTo: cle.StatusToName||undefined, 
            fieldName: cle.FieldName||undefined,
            ref: cle.StrVal1 || undefined,
            valueFrom: cle.ValueFrom || undefined,
            valueTo: cle.ValueTo || undefined
          }, cle.Timestamp)
          break;

      }
    }
    if(changelog.length == 0){ //ancient issues
      issue.prop("createddate", "2010-01-01")
      issue.prop("closeddate", "2010-01-01")

      this.addEntryIfNotExists(issue, {
        type: "legacy", 
        changeTypeName: "created", 
        changeTypeTitle: 'Created', 
        legacyId: -1, 
        text: "",
      }, "2010-01-01T00:00:00.000z")

      this.addEntryIfNotExists(issue, {
        type: "legacy", 
        changeTypeName: "changed-status", 
        changeTypeTitle: 'Changed status', 
        legacyId: -2, 
        text: "Closed",
        statusFrom: "New", 
        statusTo: "Closed", 
        valueFrom: "New",
        valueTo: "Closed"
      }, "2010-01-01T00:00:00.000z")
    }
  }

  addEntryIfNotExists(issue, entry, timestamp) {
    if(issue.history.find(e => e.data?.legacyId == entry.legacyId)) return;
    issue.addHistoryEntry(entry, timestamp.slice(0, -1))
  }

  async get(api) {
    return (await (await fetch(`${this.setup.apiUrl}/api/${api}?accessKey=${this.setup.accessKey}`)).json()).result;
  }
}

module.exports = SysService