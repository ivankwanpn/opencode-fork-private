import { Effect, Stream, Schema } from "effect";
import { Sse } from "effect/unstable/encoding";
import { HttpClientError } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { ClientApi } from "../contract";
import { ClientError } from "./client-error";
type RawClient = HttpApiClient.ForApi<typeof ClientApi>;
type Endpoint1_0Request = Parameters<RawClient["server.location"]["location.get"]>[0];
type Endpoint1_0Input = {
    readonly location?: Endpoint1_0Request["query"]["location"];
};
type Endpoint1_1Request = Parameters<RawClient["server.location"]["location.dispose"]>[0];
type Endpoint1_1Input = {
    readonly location?: Endpoint1_1Request["query"]["location"];
};
type Endpoint2_0Request = Parameters<RawClient["server.path"]["path.get"]>[0];
type Endpoint2_0Input = {
    readonly location?: Endpoint2_0Request["query"]["location"];
};
type Endpoint3_0Request = Parameters<RawClient["server.agent"]["agent.list"]>[0];
type Endpoint3_0Input = {
    readonly location?: Endpoint3_0Request["query"]["location"];
};
type Endpoint4_0Request = Parameters<RawClient["server.session"]["session.list"]>[0];
type Endpoint4_0Input = {
    readonly workspace?: Endpoint4_0Request["query"]["workspace"];
    readonly limit?: Endpoint4_0Request["query"]["limit"];
    readonly order?: Endpoint4_0Request["query"]["order"];
    readonly search?: Endpoint4_0Request["query"]["search"];
    readonly parentID?: Endpoint4_0Request["query"]["parentID"];
    readonly directory?: Endpoint4_0Request["query"]["directory"];
    readonly project?: Endpoint4_0Request["query"]["project"];
    readonly subpath?: Endpoint4_0Request["query"]["subpath"];
    readonly cursor?: Endpoint4_0Request["query"]["cursor"];
};
type Endpoint4_1Request = Parameters<RawClient["server.session"]["session.create"]>[0];
type Endpoint4_1Input = {
    readonly id?: Endpoint4_1Request["payload"]["id"];
    readonly agent?: Endpoint4_1Request["payload"]["agent"];
    readonly model?: Endpoint4_1Request["payload"]["model"];
    readonly location?: Endpoint4_1Request["payload"]["location"];
};
type Endpoint4_3Request = Parameters<RawClient["server.session"]["session.get"]>[0];
type Endpoint4_3Input = {
    readonly sessionID: Endpoint4_3Request["params"]["sessionID"];
};
type Endpoint4_4Request = Parameters<RawClient["server.session"]["session.children"]>[0];
type Endpoint4_4Input = {
    readonly sessionID: Endpoint4_4Request["params"]["sessionID"];
};
type Endpoint4_5Request = Parameters<RawClient["server.session"]["session.todo"]>[0];
type Endpoint4_5Input = {
    readonly sessionID: Endpoint4_5Request["params"]["sessionID"];
};
type Endpoint4_6Request = Parameters<RawClient["server.session"]["session.fork"]>[0];
type Endpoint4_6Input = {
    readonly sessionID: Endpoint4_6Request["params"]["sessionID"];
    readonly messageID?: Endpoint4_6Request["payload"]["messageID"];
};
type Endpoint4_7Request = Parameters<RawClient["server.session"]["session.update"]>[0];
type Endpoint4_7Input = {
    readonly sessionID: Endpoint4_7Request["params"]["sessionID"];
    readonly title?: Endpoint4_7Request["payload"]["title"];
    readonly archived?: Endpoint4_7Request["payload"]["archived"];
};
type Endpoint4_8Request = Parameters<RawClient["server.session"]["session.remove"]>[0];
type Endpoint4_8Input = {
    readonly sessionID: Endpoint4_8Request["params"]["sessionID"];
};
type Endpoint4_9Request = Parameters<RawClient["server.session"]["session.share"]>[0];
type Endpoint4_9Input = {
    readonly sessionID: Endpoint4_9Request["params"]["sessionID"];
};
type Endpoint4_10Request = Parameters<RawClient["server.session"]["session.unshare"]>[0];
type Endpoint4_10Input = {
    readonly sessionID: Endpoint4_10Request["params"]["sessionID"];
};
type Endpoint4_11Request = Parameters<RawClient["server.session"]["session.switchAgent"]>[0];
type Endpoint4_11Input = {
    readonly sessionID: Endpoint4_11Request["params"]["sessionID"];
    readonly agent: Endpoint4_11Request["payload"]["agent"];
};
type Endpoint4_12Request = Parameters<RawClient["server.session"]["session.switchModel"]>[0];
type Endpoint4_12Input = {
    readonly sessionID: Endpoint4_12Request["params"]["sessionID"];
    readonly model: Endpoint4_12Request["payload"]["model"];
};
type Endpoint4_13Request = Parameters<RawClient["server.session"]["session.prompt"]>[0];
type Endpoint4_13Input = {
    readonly sessionID: Endpoint4_13Request["params"]["sessionID"];
    readonly id?: Endpoint4_13Request["payload"]["id"];
    readonly prompt: Endpoint4_13Request["payload"]["prompt"];
    readonly model?: Endpoint4_13Request["payload"]["model"];
    readonly delivery?: Endpoint4_13Request["payload"]["delivery"];
    readonly intent?: Endpoint4_13Request["payload"]["intent"];
    readonly expectedActiveAttemptID?: Endpoint4_13Request["payload"]["expectedActiveAttemptID"];
    readonly resume?: Endpoint4_13Request["payload"]["resume"];
};
type Endpoint4_14Request = Parameters<RawClient["server.session"]["session.diff"]>[0];
type Endpoint4_14Input = {
    readonly sessionID: Endpoint4_14Request["params"]["sessionID"];
    readonly messageID?: Endpoint4_14Request["query"]["messageID"];
};
type Endpoint4_15Request = Parameters<RawClient["server.session"]["session.input.list"]>[0];
type Endpoint4_15Input = {
    readonly sessionID: Endpoint4_15Request["params"]["sessionID"];
    readonly delivery?: Endpoint4_15Request["query"]["delivery"];
};
type Endpoint4_16Request = Parameters<RawClient["server.session"]["session.input.get"]>[0];
type Endpoint4_16Input = {
    readonly sessionID: Endpoint4_16Request["params"]["sessionID"];
    readonly inputID: Endpoint4_16Request["params"]["inputID"];
};
type Endpoint4_17Request = Parameters<RawClient["server.session"]["session.input.promote"]>[0];
type Endpoint4_17Input = {
    readonly sessionID: Endpoint4_17Request["params"]["sessionID"];
    readonly inputID: Endpoint4_17Request["params"]["inputID"];
};
type Endpoint4_18Request = Parameters<RawClient["server.session"]["session.input.cancel"]>[0];
type Endpoint4_18Input = {
    readonly sessionID: Endpoint4_18Request["params"]["sessionID"];
    readonly inputID: Endpoint4_18Request["params"]["inputID"];
};
type Endpoint4_19Request = Parameters<RawClient["server.session"]["session.background"]>[0];
type Endpoint4_19Input = {
    readonly sessionID: Endpoint4_19Request["params"]["sessionID"];
    readonly callID?: Endpoint4_19Request["query"]["callID"];
};
type Endpoint4_20Request = Parameters<RawClient["server.session"]["session.command"]>[0];
type Endpoint4_20Input = {
    readonly sessionID: Endpoint4_20Request["params"]["sessionID"];
    readonly id?: Endpoint4_20Request["payload"]["id"];
    readonly command: Endpoint4_20Request["payload"]["command"];
    readonly arguments: Endpoint4_20Request["payload"]["arguments"];
    readonly agent?: Endpoint4_20Request["payload"]["agent"];
    readonly model?: Endpoint4_20Request["payload"]["model"];
    readonly files?: Endpoint4_20Request["payload"]["files"];
    readonly delivery?: Endpoint4_20Request["payload"]["delivery"];
    readonly intent?: Endpoint4_20Request["payload"]["intent"];
    readonly expectedActiveAttemptID?: Endpoint4_20Request["payload"]["expectedActiveAttemptID"];
    readonly resume?: Endpoint4_20Request["payload"]["resume"];
    readonly commit?: Endpoint4_20Request["payload"]["commit"];
};
type Endpoint4_21Request = Parameters<RawClient["server.session"]["session.shell"]>[0];
type Endpoint4_21Input = {
    readonly sessionID: Endpoint4_21Request["params"]["sessionID"];
    readonly id?: Endpoint4_21Request["payload"]["id"];
    readonly userID?: Endpoint4_21Request["payload"]["userID"];
    readonly command: Endpoint4_21Request["payload"]["command"];
    readonly agent?: Endpoint4_21Request["payload"]["agent"];
    readonly model?: Endpoint4_21Request["payload"]["model"];
    readonly resume?: Endpoint4_21Request["payload"]["resume"];
};
type Endpoint4_22Request = Parameters<RawClient["server.session"]["session.compact"]>[0];
type Endpoint4_22Input = {
    readonly sessionID: Endpoint4_22Request["params"]["sessionID"];
};
type Endpoint4_23Request = Parameters<RawClient["server.session"]["session.wait"]>[0];
type Endpoint4_23Input = {
    readonly sessionID: Endpoint4_23Request["params"]["sessionID"];
};
type Endpoint4_24Request = Parameters<RawClient["server.session"]["session.revert.stage"]>[0];
type Endpoint4_24Input = {
    readonly sessionID: Endpoint4_24Request["params"]["sessionID"];
    readonly messageID: Endpoint4_24Request["payload"]["messageID"];
    readonly files?: Endpoint4_24Request["payload"]["files"];
};
type Endpoint4_25Request = Parameters<RawClient["server.session"]["session.revert.clear"]>[0];
type Endpoint4_25Input = {
    readonly sessionID: Endpoint4_25Request["params"]["sessionID"];
};
type Endpoint4_26Request = Parameters<RawClient["server.session"]["session.revert.commit"]>[0];
type Endpoint4_26Input = {
    readonly sessionID: Endpoint4_26Request["params"]["sessionID"];
};
type Endpoint4_27Request = Parameters<RawClient["server.session"]["session.context"]>[0];
type Endpoint4_27Input = {
    readonly sessionID: Endpoint4_27Request["params"]["sessionID"];
};
type Endpoint4_28Request = Parameters<RawClient["server.session"]["session.history"]>[0];
type Endpoint4_28Input = {
    readonly sessionID: Endpoint4_28Request["params"]["sessionID"];
    readonly limit?: Endpoint4_28Request["query"]["limit"];
    readonly after?: Endpoint4_28Request["query"]["after"];
};
type Endpoint4_29Request = Parameters<RawClient["server.session"]["session.events"]>[0];
type Endpoint4_29Input = {
    readonly sessionID: Endpoint4_29Request["params"]["sessionID"];
    readonly after?: Endpoint4_29Request["query"]["after"];
};
type Endpoint4_30Request = Parameters<RawClient["server.session"]["session.interrupt"]>[0];
type Endpoint4_30Input = {
    readonly sessionID: Endpoint4_30Request["params"]["sessionID"];
};
type Endpoint4_31Request = Parameters<RawClient["server.session"]["session.message"]>[0];
type Endpoint4_31Input = {
    readonly sessionID: Endpoint4_31Request["params"]["sessionID"];
    readonly messageID: Endpoint4_31Request["params"]["messageID"];
};
type Endpoint5_0Request = Parameters<RawClient["server.message"]["session.messages"]>[0];
type Endpoint5_0Input = {
    readonly sessionID: Endpoint5_0Request["params"]["sessionID"];
    readonly limit?: Endpoint5_0Request["query"]["limit"];
    readonly order?: Endpoint5_0Request["query"]["order"];
    readonly cursor?: Endpoint5_0Request["query"]["cursor"];
};
type Endpoint6_0Request = Parameters<RawClient["server.model"]["model.list"]>[0];
type Endpoint6_0Input = {
    readonly location?: Endpoint6_0Request["query"]["location"];
};
type Endpoint7_0Request = Parameters<RawClient["server.provider"]["provider.catalog"]>[0];
type Endpoint7_0Input = {
    readonly location?: Endpoint7_0Request["query"]["location"];
};
type Endpoint7_1Request = Parameters<RawClient["server.provider"]["provider.list"]>[0];
type Endpoint7_1Input = {
    readonly location?: Endpoint7_1Request["query"]["location"];
};
type Endpoint7_2Request = Parameters<RawClient["server.provider"]["provider.get"]>[0];
type Endpoint7_2Input = {
    readonly providerID: Endpoint7_2Request["params"]["providerID"];
    readonly location?: Endpoint7_2Request["query"]["location"];
};
type Endpoint7_3Request = Parameters<RawClient["server.provider"]["provider.models.discover"]>[0];
type Endpoint7_3Input = {
    readonly providerID: Endpoint7_3Request["params"]["providerID"];
    readonly location?: Endpoint7_3Request["query"]["location"];
};
type Endpoint7_4Request = Parameters<RawClient["server.provider"]["provider.disconnect"]>[0];
type Endpoint7_4Input = {
    readonly providerID: Endpoint7_4Request["params"]["providerID"];
    readonly location?: Endpoint7_4Request["query"]["location"];
};
type Endpoint7_5Request = Parameters<RawClient["server.provider"]["provider.custom.discover"]>[0];
type Endpoint7_5Input = {
    readonly location?: Endpoint7_5Request["query"]["location"];
    readonly protocol?: Endpoint7_5Request["payload"]["protocol"];
    readonly baseURL: Endpoint7_5Request["payload"]["baseURL"];
    readonly apiKey?: Endpoint7_5Request["payload"]["apiKey"];
    readonly headers: Endpoint7_5Request["payload"]["headers"];
};
type Endpoint7_6Request = Parameters<RawClient["server.provider"]["provider.custom.configure"]>[0];
type Endpoint7_6Input = {
    readonly location?: Endpoint7_6Request["query"]["location"];
    readonly providerID: Endpoint7_6Request["payload"]["providerID"];
    readonly name: Endpoint7_6Request["payload"]["name"];
    readonly protocol?: Endpoint7_6Request["payload"]["protocol"];
    readonly update?: Endpoint7_6Request["payload"]["update"];
    readonly baseURL: Endpoint7_6Request["payload"]["baseURL"];
    readonly apiKey?: Endpoint7_6Request["payload"]["apiKey"];
    readonly headers: Endpoint7_6Request["payload"]["headers"];
    readonly models: Endpoint7_6Request["payload"]["models"];
};
type Endpoint7_7Request = Parameters<RawClient["server.provider"]["provider.custom.disconnect"]>[0];
type Endpoint7_7Input = {
    readonly providerID: Endpoint7_7Request["params"]["providerID"];
    readonly location?: Endpoint7_7Request["query"]["location"];
};
type Endpoint8_0Request = Parameters<RawClient["server.integration"]["integration.list"]>[0];
type Endpoint8_0Input = {
    readonly location?: Endpoint8_0Request["query"]["location"];
};
type Endpoint8_1Request = Parameters<RawClient["server.integration"]["integration.get"]>[0];
type Endpoint8_1Input = {
    readonly integrationID: Endpoint8_1Request["params"]["integrationID"];
    readonly location?: Endpoint8_1Request["query"]["location"];
};
type Endpoint8_2Request = Parameters<RawClient["server.integration"]["integration.connect.key"]>[0];
type Endpoint8_2Input = {
    readonly integrationID: Endpoint8_2Request["params"]["integrationID"];
    readonly location?: Endpoint8_2Request["query"]["location"];
    readonly key: Endpoint8_2Request["payload"]["key"];
    readonly label?: Endpoint8_2Request["payload"]["label"];
};
type Endpoint8_3Request = Parameters<RawClient["server.integration"]["integration.connect.oauth"]>[0];
type Endpoint8_3Input = {
    readonly integrationID: Endpoint8_3Request["params"]["integrationID"];
    readonly location?: Endpoint8_3Request["query"]["location"];
    readonly methodID: Endpoint8_3Request["payload"]["methodID"];
    readonly inputs: Endpoint8_3Request["payload"]["inputs"];
    readonly label?: Endpoint8_3Request["payload"]["label"];
};
type Endpoint8_4Request = Parameters<RawClient["server.integration"]["integration.attempt.status"]>[0];
type Endpoint8_4Input = {
    readonly attemptID: Endpoint8_4Request["params"]["attemptID"];
    readonly location?: Endpoint8_4Request["query"]["location"];
};
type Endpoint8_5Request = Parameters<RawClient["server.integration"]["integration.attempt.complete"]>[0];
type Endpoint8_5Input = {
    readonly attemptID: Endpoint8_5Request["params"]["attemptID"];
    readonly location?: Endpoint8_5Request["query"]["location"];
    readonly code?: Endpoint8_5Request["payload"]["code"];
};
type Endpoint8_6Request = Parameters<RawClient["server.integration"]["integration.attempt.cancel"]>[0];
type Endpoint8_6Input = {
    readonly attemptID: Endpoint8_6Request["params"]["attemptID"];
    readonly location?: Endpoint8_6Request["query"]["location"];
};
type Endpoint9_0Request = Parameters<RawClient["server.credential"]["credential.update"]>[0];
type Endpoint9_0Input = {
    readonly credentialID: Endpoint9_0Request["params"]["credentialID"];
    readonly location?: Endpoint9_0Request["query"]["location"];
    readonly label: Endpoint9_0Request["payload"]["label"];
};
type Endpoint9_1Request = Parameters<RawClient["server.credential"]["credential.remove"]>[0];
type Endpoint9_1Input = {
    readonly credentialID: Endpoint9_1Request["params"]["credentialID"];
    readonly location?: Endpoint9_1Request["query"]["location"];
};
type Endpoint10_0Request = Parameters<RawClient["server.permission"]["permission.request.list"]>[0];
type Endpoint10_0Input = {
    readonly location?: Endpoint10_0Request["query"]["location"];
};
type Endpoint10_1Request = Parameters<RawClient["server.permission"]["permission.saved.list"]>[0];
type Endpoint10_1Input = {
    readonly projectID?: Endpoint10_1Request["query"]["projectID"];
};
type Endpoint10_2Request = Parameters<RawClient["server.permission"]["permission.saved.remove"]>[0];
type Endpoint10_2Input = {
    readonly id: Endpoint10_2Request["params"]["id"];
};
type Endpoint10_3Request = Parameters<RawClient["server.permission"]["session.permission.create"]>[0];
type Endpoint10_3Input = {
    readonly sessionID: Endpoint10_3Request["params"]["sessionID"];
    readonly id?: Endpoint10_3Request["payload"]["id"];
    readonly action: Endpoint10_3Request["payload"]["action"];
    readonly resources: Endpoint10_3Request["payload"]["resources"];
    readonly save?: Endpoint10_3Request["payload"]["save"];
    readonly metadata?: Endpoint10_3Request["payload"]["metadata"];
    readonly source?: Endpoint10_3Request["payload"]["source"];
    readonly agent?: Endpoint10_3Request["payload"]["agent"];
};
type Endpoint10_4Request = Parameters<RawClient["server.permission"]["session.permission.list"]>[0];
type Endpoint10_4Input = {
    readonly sessionID: Endpoint10_4Request["params"]["sessionID"];
};
type Endpoint10_5Request = Parameters<RawClient["server.permission"]["session.permission.get"]>[0];
type Endpoint10_5Input = {
    readonly sessionID: Endpoint10_5Request["params"]["sessionID"];
    readonly requestID: Endpoint10_5Request["params"]["requestID"];
};
type Endpoint10_6Request = Parameters<RawClient["server.permission"]["session.permission.reply"]>[0];
type Endpoint10_6Input = {
    readonly sessionID: Endpoint10_6Request["params"]["sessionID"];
    readonly requestID: Endpoint10_6Request["params"]["requestID"];
    readonly reply: Endpoint10_6Request["payload"]["reply"];
    readonly message?: Endpoint10_6Request["payload"]["message"];
};
type Endpoint11_0Request = Parameters<RawClient["server.fs"]["fs.read"]>[0];
type Endpoint11_0Input = {
    readonly location?: Endpoint11_0Request["query"]["location"];
    readonly path: Endpoint11_0Request["query"]["path"];
};
type Endpoint11_1Request = Parameters<RawClient["server.fs"]["fs.list"]>[0];
type Endpoint11_1Input = {
    readonly location?: Endpoint11_1Request["query"]["location"];
    readonly path?: Endpoint11_1Request["query"]["path"];
};
type Endpoint11_2Request = Parameters<RawClient["server.fs"]["fs.find"]>[0];
type Endpoint11_2Input = {
    readonly location?: Endpoint11_2Request["query"]["location"];
    readonly query: Endpoint11_2Request["query"]["query"];
    readonly type?: Endpoint11_2Request["query"]["type"];
    readonly limit?: Endpoint11_2Request["query"]["limit"];
};
type Endpoint12_0Request = Parameters<RawClient["server.command"]["command.list"]>[0];
type Endpoint12_0Input = {
    readonly location?: Endpoint12_0Request["query"]["location"];
};
type Endpoint13_0Request = Parameters<RawClient["server.skill"]["skill.list"]>[0];
type Endpoint13_0Input = {
    readonly location?: Endpoint13_0Request["query"]["location"];
};
type Endpoint14_0Request = Parameters<RawClient["server.mcp"]["mcp.status"]>[0];
type Endpoint14_0Input = {
    readonly location?: Endpoint14_0Request["query"]["location"];
};
type Endpoint14_1Request = Parameters<RawClient["server.mcp"]["mcp.resources"]>[0];
type Endpoint14_1Input = {
    readonly location?: Endpoint14_1Request["query"]["location"];
};
type Endpoint14_2Request = Parameters<RawClient["server.mcp"]["mcp.connect"]>[0];
type Endpoint14_2Input = {
    readonly name: Endpoint14_2Request["params"]["name"];
    readonly location?: Endpoint14_2Request["query"]["location"];
};
type Endpoint14_3Request = Parameters<RawClient["server.mcp"]["mcp.disconnect"]>[0];
type Endpoint14_3Input = {
    readonly name: Endpoint14_3Request["params"]["name"];
    readonly location?: Endpoint14_3Request["query"]["location"];
};
type Endpoint14_4Request = Parameters<RawClient["server.mcp"]["mcp.authenticate"]>[0];
type Endpoint14_4Input = {
    readonly name: Endpoint14_4Request["params"]["name"];
    readonly location?: Endpoint14_4Request["query"]["location"];
};
type Endpoint15_0Request = Parameters<RawClient["server.lsp"]["lsp.status"]>[0];
type Endpoint15_0Input = {
    readonly location?: Endpoint15_0Request["query"]["location"];
};
type Endpoint16_1Request = Parameters<RawClient["server.project"]["project.initGit"]>[0];
type Endpoint16_1Input = {
    readonly location?: Endpoint16_1Request["query"]["location"];
};
type Endpoint16_2Request = Parameters<RawClient["server.project"]["project.current"]>[0];
type Endpoint16_2Input = {
    readonly location?: Endpoint16_2Request["query"]["location"];
};
type Endpoint16_3Request = Parameters<RawClient["server.project"]["project.update"]>[0];
type Endpoint16_3Input = {
    readonly projectID: Endpoint16_3Request["params"]["projectID"];
    readonly name?: Endpoint16_3Request["payload"]["name"];
    readonly icon?: Endpoint16_3Request["payload"]["icon"];
    readonly commands?: Endpoint16_3Request["payload"]["commands"];
};
type Endpoint16_4Request = Parameters<RawClient["server.project"]["project.directories"]>[0];
type Endpoint16_4Input = {
    readonly projectID: Endpoint16_4Request["params"]["projectID"];
    readonly location?: Endpoint16_4Request["query"]["location"];
};
type Endpoint17_0Request = Parameters<RawClient["server.worktree"]["worktree.create"]>[0];
type Endpoint17_0Input = {
    readonly location?: Endpoint17_0Request["query"]["location"];
    readonly name?: Endpoint17_0Request["payload"]["name"];
    readonly startCommand?: Endpoint17_0Request["payload"]["startCommand"];
};
type Endpoint17_1Request = Parameters<RawClient["server.worktree"]["worktree.remove"]>[0];
type Endpoint17_1Input = {
    readonly location?: Endpoint17_1Request["query"]["location"];
    readonly directory: Endpoint17_1Request["payload"]["directory"];
};
type Endpoint17_2Request = Parameters<RawClient["server.worktree"]["worktree.reset"]>[0];
type Endpoint17_2Input = {
    readonly location?: Endpoint17_2Request["query"]["location"];
    readonly directory: Endpoint17_2Request["payload"]["directory"];
};
type Endpoint19_0Request = Parameters<RawClient["server.vcs"]["vcs.get"]>[0];
type Endpoint19_0Input = {
    readonly location?: Endpoint19_0Request["query"]["location"];
};
type Endpoint19_1Request = Parameters<RawClient["server.vcs"]["vcs.status"]>[0];
type Endpoint19_1Input = {
    readonly location?: Endpoint19_1Request["query"]["location"];
};
type Endpoint19_2Request = Parameters<RawClient["server.vcs"]["vcs.diff"]>[0];
type Endpoint19_2Input = {
    readonly location?: Endpoint19_2Request["query"]["location"];
    readonly mode: Endpoint19_2Request["query"]["mode"];
    readonly context?: Endpoint19_2Request["query"]["context"];
};
type Endpoint20_0Request = Parameters<RawClient["server.formatter"]["formatter.status"]>[0];
type Endpoint20_0Input = {
    readonly location?: Endpoint20_0Request["query"]["location"];
};
type Endpoint21_0Request = Parameters<RawClient["server.console"]["console.get"]>[0];
type Endpoint21_0Input = {
    readonly location?: Endpoint21_0Request["query"]["location"];
};
type Endpoint21_1Request = Parameters<RawClient["server.console"]["console.org.list"]>[0];
type Endpoint21_1Input = {
    readonly location?: Endpoint21_1Request["query"]["location"];
};
type Endpoint21_2Request = Parameters<RawClient["server.console"]["console.org.switch"]>[0];
type Endpoint21_2Input = {
    readonly location?: Endpoint21_2Request["query"]["location"];
    readonly accountID: Endpoint21_2Request["payload"]["accountID"];
    readonly orgID: Endpoint21_2Request["payload"]["orgID"];
};
type Endpoint22_0Request = Parameters<RawClient["server.config"]["config.get"]>[0];
type Endpoint22_0Input = {
    readonly location?: Endpoint22_0Request["query"]["location"];
};
type Endpoint22_1Request = Parameters<RawClient["server.config"]["config.update"]>[0];
type Endpoint22_1Input = {
    readonly config: Endpoint22_1Request["payload"]["config"];
};
type Endpoint23_0Request = Parameters<RawClient["server.workspace"]["workspace.adapter.list"]>[0];
type Endpoint23_0Input = {
    readonly location?: Endpoint23_0Request["query"]["location"];
};
type Endpoint23_1Request = Parameters<RawClient["server.workspace"]["workspace.list"]>[0];
type Endpoint23_1Input = {
    readonly location?: Endpoint23_1Request["query"]["location"];
};
type Endpoint23_2Request = Parameters<RawClient["server.workspace"]["workspace.create"]>[0];
type Endpoint23_2Input = {
    readonly location?: Endpoint23_2Request["query"]["location"];
    readonly id?: Endpoint23_2Request["payload"]["id"];
    readonly type: Endpoint23_2Request["payload"]["type"];
    readonly branch?: Endpoint23_2Request["payload"]["branch"];
    readonly extra?: Endpoint23_2Request["payload"]["extra"];
};
type Endpoint23_3Request = Parameters<RawClient["server.workspace"]["workspace.remove"]>[0];
type Endpoint23_3Input = {
    readonly workspaceID: Endpoint23_3Request["params"]["workspaceID"];
    readonly location?: Endpoint23_3Request["query"]["location"];
};
type Endpoint23_4Request = Parameters<RawClient["server.workspace"]["workspace.status"]>[0];
type Endpoint23_4Input = {
    readonly location?: Endpoint23_4Request["query"]["location"];
};
type Endpoint23_5Request = Parameters<RawClient["server.workspace"]["workspace.syncList"]>[0];
type Endpoint23_5Input = {
    readonly location?: Endpoint23_5Request["query"]["location"];
};
type Endpoint23_6Request = Parameters<RawClient["server.workspace"]["workspace.start"]>[0];
type Endpoint23_6Input = {
    readonly location?: Endpoint23_6Request["query"]["location"];
};
type Endpoint23_7Request = Parameters<RawClient["server.workspace"]["workspace.warp"]>[0];
type Endpoint23_7Input = {
    readonly location?: Endpoint23_7Request["query"]["location"];
    readonly workspaceID: Endpoint23_7Request["payload"]["workspaceID"];
    readonly sessionID: Endpoint23_7Request["payload"]["sessionID"];
    readonly copyChanges?: Endpoint23_7Request["payload"]["copyChanges"];
};
type Endpoint24_0Request = Parameters<RawClient["server.controlPlane"]["controlPlane.moveSession"]>[0];
type Endpoint24_0Input = {
    readonly sessionID: Endpoint24_0Request["payload"]["sessionID"];
    readonly destination: Endpoint24_0Request["payload"]["destination"];
    readonly moveChanges?: Endpoint24_0Request["payload"]["moveChanges"];
};
type Endpoint25_0Request = Parameters<RawClient["server.plugins"]["plugins.runtime"]>[0];
type Endpoint25_0Input = {
    readonly location?: Endpoint25_0Request["query"]["location"];
};
type Endpoint25_2Request = Parameters<RawClient["server.plugins"]["plugins.marketplace.add"]>[0];
type Endpoint25_2Input = {
    readonly source: Endpoint25_2Request["payload"]["source"];
};
type Endpoint25_3Request = Parameters<RawClient["server.plugins"]["plugins.marketplace.refresh"]>[0];
type Endpoint25_3Input = {
    readonly name: Endpoint25_3Request["payload"]["name"];
};
type Endpoint25_4Request = Parameters<RawClient["server.plugins"]["plugins.marketplace.remove"]>[0];
type Endpoint25_4Input = {
    readonly name: Endpoint25_4Request["payload"]["name"];
};
type Endpoint25_5Request = Parameters<RawClient["server.plugins"]["plugins.install"]>[0];
type Endpoint25_5Input = {
    readonly id: Endpoint25_5Request["payload"]["id"];
};
type Endpoint25_6Request = Parameters<RawClient["server.plugins"]["plugins.uninstall"]>[0];
type Endpoint25_6Input = {
    readonly id: Endpoint25_6Request["payload"]["id"];
};
type Endpoint25_7Request = Parameters<RawClient["server.plugins"]["plugins.enable"]>[0];
type Endpoint25_7Input = {
    readonly id: Endpoint25_7Request["payload"]["id"];
};
type Endpoint25_8Request = Parameters<RawClient["server.plugins"]["plugins.disable"]>[0];
type Endpoint25_8Input = {
    readonly id: Endpoint25_8Request["payload"]["id"];
};
type Endpoint25_9Request = Parameters<RawClient["server.plugins"]["plugins.direct.inspect"]>[0];
type Endpoint25_9Input = {
    readonly source: Endpoint25_9Request["payload"]["source"];
};
type Endpoint25_10Request = Parameters<RawClient["server.plugins"]["plugins.direct.install"]>[0];
type Endpoint25_10Input = {
    readonly source: Endpoint25_10Request["payload"]["source"];
    readonly trusted: Endpoint25_10Request["payload"]["trusted"];
    readonly approvedCapabilities: Endpoint25_10Request["payload"]["approvedCapabilities"];
};
type Endpoint25_11Request = Parameters<RawClient["server.plugins"]["plugins.direct.uninstall"]>[0];
type Endpoint25_11Input = {
    readonly id: Endpoint25_11Request["payload"]["id"];
};
type Endpoint25_12Request = Parameters<RawClient["server.plugins"]["plugins.direct.enable"]>[0];
type Endpoint25_12Input = {
    readonly id: Endpoint25_12Request["payload"]["id"];
};
type Endpoint25_13Request = Parameters<RawClient["server.plugins"]["plugins.direct.disable"]>[0];
type Endpoint25_13Input = {
    readonly id: Endpoint25_13Request["payload"]["id"];
};
type Endpoint25_14Request = Parameters<RawClient["server.plugins"]["plugins.mcp.install"]>[0];
type Endpoint25_14Input = {
    readonly name: Endpoint25_14Request["payload"]["name"];
    readonly config: Endpoint25_14Request["payload"]["config"];
};
type Endpoint25_15Request = Parameters<RawClient["server.plugins"]["plugins.mcp.remove"]>[0];
type Endpoint25_15Input = {
    readonly name: Endpoint25_15Request["payload"]["name"];
};
type Endpoint25_16Request = Parameters<RawClient["server.plugins"]["plugins.mcp.enable"]>[0];
type Endpoint25_16Input = {
    readonly name: Endpoint25_16Request["payload"]["name"];
};
type Endpoint25_17Request = Parameters<RawClient["server.plugins"]["plugins.mcp.disable"]>[0];
type Endpoint25_17Input = {
    readonly name: Endpoint25_17Request["payload"]["name"];
};
type Endpoint27_0Request = Parameters<RawClient["server.pty"]["pty.shells"]>[0];
type Endpoint27_0Input = {
    readonly location?: Endpoint27_0Request["query"]["location"];
};
type Endpoint27_1Request = Parameters<RawClient["server.pty"]["pty.list"]>[0];
type Endpoint27_1Input = {
    readonly location?: Endpoint27_1Request["query"]["location"];
};
type Endpoint27_2Request = Parameters<RawClient["server.pty"]["pty.create"]>[0];
type Endpoint27_2Input = {
    readonly location?: Endpoint27_2Request["query"]["location"];
    readonly command?: Endpoint27_2Request["payload"]["command"];
    readonly args?: Endpoint27_2Request["payload"]["args"];
    readonly cwd?: Endpoint27_2Request["payload"]["cwd"];
    readonly title?: Endpoint27_2Request["payload"]["title"];
    readonly env?: Endpoint27_2Request["payload"]["env"];
};
type Endpoint27_3Request = Parameters<RawClient["server.pty"]["pty.get"]>[0];
type Endpoint27_3Input = {
    readonly ptyID: Endpoint27_3Request["params"]["ptyID"];
    readonly location?: Endpoint27_3Request["query"]["location"];
};
type Endpoint27_4Request = Parameters<RawClient["server.pty"]["pty.update"]>[0];
type Endpoint27_4Input = {
    readonly ptyID: Endpoint27_4Request["params"]["ptyID"];
    readonly location?: Endpoint27_4Request["query"]["location"];
    readonly title?: Endpoint27_4Request["payload"]["title"];
    readonly size?: Endpoint27_4Request["payload"]["size"];
};
type Endpoint27_5Request = Parameters<RawClient["server.pty"]["pty.remove"]>[0];
type Endpoint27_5Input = {
    readonly ptyID: Endpoint27_5Request["params"]["ptyID"];
    readonly location?: Endpoint27_5Request["query"]["location"];
};
type Endpoint28_0Request = Parameters<RawClient["server.question"]["question.request.list"]>[0];
type Endpoint28_0Input = {
    readonly location?: Endpoint28_0Request["query"]["location"];
};
type Endpoint28_1Request = Parameters<RawClient["server.question"]["session.question.list"]>[0];
type Endpoint28_1Input = {
    readonly sessionID: Endpoint28_1Request["params"]["sessionID"];
};
type Endpoint28_2Request = Parameters<RawClient["server.question"]["session.question.reply"]>[0];
type Endpoint28_2Input = {
    readonly sessionID: Endpoint28_2Request["params"]["sessionID"];
    readonly requestID: Endpoint28_2Request["params"]["requestID"];
    readonly answers: Endpoint28_2Request["payload"]["answers"];
};
type Endpoint28_3Request = Parameters<RawClient["server.question"]["session.question.reject"]>[0];
type Endpoint28_3Input = {
    readonly sessionID: Endpoint28_3Request["params"]["sessionID"];
    readonly requestID: Endpoint28_3Request["params"]["requestID"];
};
type Endpoint29_0Request = Parameters<RawClient["server.reference"]["reference.list"]>[0];
type Endpoint29_0Input = {
    readonly location?: Endpoint29_0Request["query"]["location"];
};
type Endpoint30_0Request = Parameters<RawClient["server.projectCopy"]["projectCopy.generateName"]>[0];
type Endpoint30_0Input = {
    readonly projectID: Endpoint30_0Request["params"]["projectID"];
    readonly location?: Endpoint30_0Request["query"]["location"];
    readonly context?: Endpoint30_0Request["payload"]["context"];
};
type Endpoint30_1Request = Parameters<RawClient["server.projectCopy"]["projectCopy.create"]>[0];
type Endpoint30_1Input = {
    readonly projectID: Endpoint30_1Request["params"]["projectID"];
    readonly location?: Endpoint30_1Request["query"]["location"];
    readonly strategy: Endpoint30_1Request["payload"]["strategy"];
    readonly directory: Endpoint30_1Request["payload"]["directory"];
    readonly name?: Endpoint30_1Request["payload"]["name"];
};
type Endpoint30_2Request = Parameters<RawClient["server.projectCopy"]["projectCopy.remove"]>[0];
type Endpoint30_2Input = {
    readonly projectID: Endpoint30_2Request["params"]["projectID"];
    readonly location?: Endpoint30_2Request["query"]["location"];
    readonly directory: Endpoint30_2Request["payload"]["directory"];
    readonly force: Endpoint30_2Request["payload"]["force"];
};
type Endpoint30_3Request = Parameters<RawClient["server.projectCopy"]["projectCopy.refresh"]>[0];
type Endpoint30_3Input = {
    readonly projectID: Endpoint30_3Request["params"]["projectID"];
    readonly location?: Endpoint30_3Request["query"]["location"];
};
export declare const make: (options?: {
    readonly baseUrl?: string | URL | undefined;
} | undefined) => Effect.Effect<{
    health: {
        get: () => Effect.Effect<{
            readonly healthy: true;
            readonly pid: number;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    location: {
        get: (input?: Endpoint1_0Input | undefined) => Effect.Effect<import("@opencode-ai/schema/location").Info, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        dispose: (input?: Endpoint1_1Input | undefined) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    path: {
        get: (input?: Endpoint2_0Input | undefined) => Effect.Effect<{
            readonly home: string & import("effect/Brand").Brand<"AbsolutePath">;
            readonly state: string & import("effect/Brand").Brand<"AbsolutePath">;
            readonly config: string & import("effect/Brand").Brand<"AbsolutePath">;
            readonly worktree: string & import("effect/Brand").Brand<"AbsolutePath">;
            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    agents: {
        list: (input?: Endpoint3_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"AgentV2.ID">;
                readonly model?: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                } | undefined;
                readonly request: {
                    readonly headers: {
                        readonly [x: string]: string;
                    };
                    readonly body: {
                        readonly [x: string]: Schema.Json;
                    };
                };
                readonly system?: string | undefined;
                readonly description?: string | undefined;
                readonly mode: "all" | "primary" | "subagent";
                readonly hidden: boolean;
                readonly color?: string | undefined;
                readonly steps?: number | undefined;
                readonly permissions: readonly {
                    readonly action: string;
                    readonly resource: string;
                    readonly effect: "allow" | "ask" | "deny";
                }[];
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    sessions: {
        list: (input?: Endpoint4_0Input | undefined) => Effect.Effect<{
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"SessionID">;
                readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                readonly model?: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                } | undefined;
                readonly cost: number;
                readonly tokens: {
                    readonly input: number;
                    readonly output: number;
                    readonly reasoning: number;
                    readonly cache: {
                        readonly read: number;
                        readonly write: number;
                    };
                };
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly updated: import("effect/DateTime").Utc;
                    readonly compacting?: import("effect/DateTime").Utc | undefined;
                    readonly archived?: import("effect/DateTime").Utc | undefined;
                };
                readonly title: string;
                readonly metadata?: {
                    readonly [x: string]: Schema.Json;
                } | undefined;
                readonly share?: {
                    readonly url: string;
                } | undefined;
                readonly location: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                };
                readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                readonly revert?: {
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly partID?: string | undefined;
                    readonly contentIndex?: number | undefined;
                    readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                    readonly snapshot?: string | undefined;
                    readonly diff?: string | undefined;
                    readonly files?: readonly {
                        readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                        readonly status: "added" | "deleted" | "modified";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }[] | undefined;
                } | undefined;
            }[];
            readonly cursor: {
                readonly previous?: (string & import("effect/Brand").Brand<"SessionsCursor">) | undefined;
                readonly next?: (string & import("effect/Brand").Brand<"SessionsCursor">) | undefined;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidCursorError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        create: (input?: Endpoint4_1Input | undefined) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"SessionID">;
            readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
            readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
            readonly model?: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            } | undefined;
            readonly cost: number;
            readonly tokens: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            };
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly updated: import("effect/DateTime").Utc;
                readonly compacting?: import("effect/DateTime").Utc | undefined;
                readonly archived?: import("effect/DateTime").Utc | undefined;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: Schema.Json;
            } | undefined;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            };
            readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            readonly revert?: {
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        active: () => Effect.Effect<{
            readonly [x: string & import("effect/Brand").Brand<"SessionID">]: {
                readonly type: "running";
                readonly turnID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                readonly phase?: "active" | "pending" | undefined;
                readonly activity?: "compacting" | "dispatching" | "responding" | "running-tool" | "waiting-user" | undefined;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        get: (input: Endpoint4_3Input) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"SessionID">;
            readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
            readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
            readonly model?: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            } | undefined;
            readonly cost: number;
            readonly tokens: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            };
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly updated: import("effect/DateTime").Utc;
                readonly compacting?: import("effect/DateTime").Utc | undefined;
                readonly archived?: import("effect/DateTime").Utc | undefined;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: Schema.Json;
            } | undefined;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            };
            readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            readonly revert?: {
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        children: (input: Endpoint4_4Input) => Effect.Effect<readonly {
            readonly id: string & import("effect/Brand").Brand<"SessionID">;
            readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
            readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
            readonly model?: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            } | undefined;
            readonly cost: number;
            readonly tokens: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            };
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly updated: import("effect/DateTime").Utc;
                readonly compacting?: import("effect/DateTime").Utc | undefined;
                readonly archived?: import("effect/DateTime").Utc | undefined;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: Schema.Json;
            } | undefined;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            };
            readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            readonly revert?: {
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        todo: (input: Endpoint4_5Input) => Effect.Effect<readonly {
            readonly content: string;
            readonly status: string;
            readonly priority: string;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        fork: (input: Endpoint4_6Input) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"SessionID">;
            readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
            readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
            readonly model?: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            } | undefined;
            readonly cost: number;
            readonly tokens: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            };
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly updated: import("effect/DateTime").Utc;
                readonly compacting?: import("effect/DateTime").Utc | undefined;
                readonly archived?: import("effect/DateTime").Utc | undefined;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: Schema.Json;
            } | undefined;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            };
            readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            readonly revert?: {
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").MessageNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/errors").UnknownError, never>;
        update: (input: Endpoint4_7Input) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"SessionID">;
            readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
            readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
            readonly model?: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            } | undefined;
            readonly cost: number;
            readonly tokens: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            };
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly updated: import("effect/DateTime").Utc;
                readonly compacting?: import("effect/DateTime").Utc | undefined;
                readonly archived?: import("effect/DateTime").Utc | undefined;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: Schema.Json;
            } | undefined;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            };
            readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            readonly revert?: {
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        remove: (input: Endpoint4_8Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        share: (input: Endpoint4_9Input) => Effect.Effect<{
            readonly url: string;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        unshare: (input: Endpoint4_10Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        switchAgent: (input: Endpoint4_11Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        switchModel: (input: Endpoint4_12Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        prompt: (input: Endpoint4_13Input) => Effect.Effect<{
            readonly admittedSeq: number;
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                }[] | undefined;
                readonly files?: readonly {
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly description?: string | undefined;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                    readonly materialized?: readonly ({
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    })[] | undefined;
                }[] | undefined;
                readonly agents?: readonly {
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly guidance?: string | undefined;
                }[] | undefined;
                readonly system?: string | undefined;
                readonly tools?: {
                    readonly [x: string]: boolean;
                } | undefined;
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: unknown;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "session" | "turn" | undefined;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            } | {
                readonly type: "queue";
            } | undefined;
            readonly timeCreated: import("effect/DateTime").Utc;
            readonly promotedSeq?: number | undefined;
        }, ClientError | import("@opencode-ai/protocol/errors").ConflictError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").SessionTurnConflictError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        diff: (input: Endpoint4_14Input) => Effect.Effect<readonly {
            readonly file?: string | undefined;
            readonly patch?: string | undefined;
            readonly additions: number;
            readonly deletions: number;
            readonly status?: "added" | "deleted" | "modified" | undefined;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        inputList: (input: Endpoint4_15Input) => Effect.Effect<readonly {
            readonly admittedSeq: number;
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                }[] | undefined;
                readonly files?: readonly {
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly description?: string | undefined;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                    readonly materialized?: readonly ({
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    })[] | undefined;
                }[] | undefined;
                readonly agents?: readonly {
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly guidance?: string | undefined;
                }[] | undefined;
                readonly system?: string | undefined;
                readonly tools?: {
                    readonly [x: string]: boolean;
                } | undefined;
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: unknown;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "session" | "turn" | undefined;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            } | {
                readonly type: "queue";
            } | undefined;
            readonly timeCreated: import("effect/DateTime").Utc;
            readonly promotedSeq?: number | undefined;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        inputGet: (input: Endpoint4_16Input) => Effect.Effect<{
            readonly admittedSeq: number;
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                }[] | undefined;
                readonly files?: readonly {
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly description?: string | undefined;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                    readonly materialized?: readonly ({
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    })[] | undefined;
                }[] | undefined;
                readonly agents?: readonly {
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly guidance?: string | undefined;
                }[] | undefined;
                readonly system?: string | undefined;
                readonly tools?: {
                    readonly [x: string]: boolean;
                } | undefined;
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: unknown;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "session" | "turn" | undefined;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            } | {
                readonly type: "queue";
            } | undefined;
            readonly timeCreated: import("effect/DateTime").Utc;
            readonly promotedSeq?: number | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionInputNotFoundError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        inputPromote: (input: Endpoint4_17Input) => Effect.Effect<{
            readonly admittedSeq: number;
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                }[] | undefined;
                readonly files?: readonly {
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly description?: string | undefined;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                    readonly materialized?: readonly ({
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    })[] | undefined;
                }[] | undefined;
                readonly agents?: readonly {
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly guidance?: string | undefined;
                }[] | undefined;
                readonly system?: string | undefined;
                readonly tools?: {
                    readonly [x: string]: boolean;
                } | undefined;
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: unknown;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "session" | "turn" | undefined;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            } | {
                readonly type: "queue";
            } | undefined;
            readonly timeCreated: import("effect/DateTime").Utc;
            readonly promotedSeq?: number | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionInputConflictError | import("@opencode-ai/protocol/errors").SessionInputNotFoundError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        inputCancel: (input: Endpoint4_18Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionInputConflictError | import("@opencode-ai/protocol/errors").SessionInputNotFoundError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        background: (input: Endpoint4_19Input) => Effect.Effect<boolean, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        command: (input: Endpoint4_20Input) => Effect.Effect<{
            readonly admittedSeq: number;
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                }[] | undefined;
                readonly files?: readonly {
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly description?: string | undefined;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                    readonly materialized?: readonly ({
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    })[] | undefined;
                }[] | undefined;
                readonly agents?: readonly {
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly guidance?: string | undefined;
                }[] | undefined;
                readonly system?: string | undefined;
                readonly tools?: {
                    readonly [x: string]: boolean;
                } | undefined;
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: unknown;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "session" | "turn" | undefined;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            } | {
                readonly type: "queue";
            } | undefined;
            readonly timeCreated: import("effect/DateTime").Utc;
            readonly promotedSeq?: number | undefined;
        }, ClientError | import("@opencode-ai/protocol/errors").ConflictError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").SessionTurnConflictError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        shell: (input: Endpoint4_21Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        compact: (input: Endpoint4_22Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        wait: (input: Endpoint4_23Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        stage: (input: Endpoint4_24Input) => Effect.Effect<{
            readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly partID?: string | undefined;
            readonly contentIndex?: number | undefined;
            readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
            readonly snapshot?: string | undefined;
            readonly diff?: string | undefined;
            readonly files?: readonly {
                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                readonly status: "added" | "deleted" | "modified";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }[] | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").MessageNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/errors").UnknownError, never>;
        clear: (input: Endpoint4_25Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/errors").UnknownError, never>;
        commit: (input: Endpoint4_26Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        context: (input: Endpoint4_27Input) => Effect.Effect<readonly ({
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "agent-switched";
            readonly agent: string;
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "model-switched";
            readonly model: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly text: string;
            readonly context?: readonly {
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
            }[] | undefined;
            readonly files?: readonly {
                readonly uri: string;
                readonly mime: string;
                readonly name?: string | undefined;
                readonly description?: string | undefined;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                } | undefined;
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                } | undefined;
                readonly materialized?: readonly ({
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                } | {
                    readonly type: "error";
                    readonly message: string;
                })[] | undefined;
            }[] | undefined;
            readonly agents?: readonly {
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                } | undefined;
                readonly guidance?: string | undefined;
            }[] | undefined;
            readonly system?: string | undefined;
            readonly tools?: {
                readonly [x: string]: boolean;
            } | undefined;
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: unknown;
                };
                readonly retryCount?: number | undefined;
            } | undefined;
            readonly type: "user";
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly text: string;
            readonly description?: string | undefined;
            readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            readonly type: "synthetic";
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "system";
            readonly text: string;
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "shell";
            readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
            readonly callID: string;
            readonly command: string;
            readonly output: string;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly completed?: import("effect/DateTime").Utc | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "assistant";
            readonly agent: string;
            readonly model: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            };
            readonly content: readonly ({
                readonly type: "text";
                readonly id: string;
                readonly text: string;
            } | {
                readonly type: "reasoning";
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
                readonly time?: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly completed?: import("effect/DateTime").Utc | undefined;
                } | undefined;
            } | {
                readonly type: "tool";
                readonly id: string;
                readonly name: string;
                readonly provider?: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                    readonly resultMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                } | undefined;
                readonly state: {
                    readonly status: "pending";
                    readonly input: string;
                } | {
                    readonly status: "running";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                } | {
                    readonly status: "completed";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly attachments?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly outputPaths?: readonly string[] | undefined;
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly result?: unknown;
                } | {
                    readonly status: "error";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                    readonly result?: unknown;
                };
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly ran?: import("effect/DateTime").Utc | undefined;
                    readonly completed?: import("effect/DateTime").Utc | undefined;
                    readonly pruned?: import("effect/DateTime").Utc | undefined;
                };
            })[];
            readonly snapshot?: {
                readonly start?: string | undefined;
                readonly end?: string | undefined;
                readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                readonly patch?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
            readonly finish?: string | undefined;
            readonly structured?: unknown;
            readonly cost?: number | undefined;
            readonly tokens?: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            } | undefined;
            readonly error?: {
                readonly type: "unknown";
                readonly message: string;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly completed?: import("effect/DateTime").Utc | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "compaction";
            readonly reason: "auto" | "manual";
            readonly summary: string;
            readonly recent: string;
        })[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/errors").UnknownError, never>;
        history: (input: Endpoint4_28Input) => Effect.Effect<{
            readonly data: readonly ({
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.created";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly info: {
                        readonly id: string & import("effect/Brand").Brand<"SessionID">;
                        readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                        readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                        readonly slug: string;
                        readonly version: string;
                        readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                        readonly model?: {
                            readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                            readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                            readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                            readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                        } | undefined;
                        readonly cost: number;
                        readonly tokens: {
                            readonly input: number;
                            readonly output: number;
                            readonly reasoning: number;
                            readonly cache: {
                                readonly read: number;
                                readonly write: number;
                            };
                        };
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly updated: import("effect/DateTime").Utc;
                            readonly compacting?: import("effect/DateTime").Utc | undefined;
                            readonly archived?: import("effect/DateTime").Utc | undefined;
                        };
                        readonly title: string;
                        readonly metadata?: {
                            readonly [x: string]: Schema.Json;
                        } | undefined;
                        readonly share?: {
                            readonly url: string;
                        } | undefined;
                        readonly permission?: readonly {
                            readonly action: string;
                            readonly resource: string;
                            readonly effect: "allow" | "ask" | "deny";
                        }[] | undefined;
                        readonly location: {
                            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                            readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                        };
                        readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                        readonly revert?: {
                            readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                            readonly partID?: string | undefined;
                            readonly contentIndex?: number | undefined;
                            readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                            readonly snapshot?: string | undefined;
                            readonly diff?: string | undefined;
                            readonly files?: readonly {
                                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                                readonly status: "added" | "deleted" | "modified";
                                readonly additions: number;
                                readonly deletions: number;
                                readonly patch: string;
                            }[] | undefined;
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.updated";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly info: {
                        readonly id: string & import("effect/Brand").Brand<"SessionID">;
                        readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                        readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                        readonly slug: string;
                        readonly version: string;
                        readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                        readonly model?: {
                            readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                            readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                            readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                            readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                        } | undefined;
                        readonly cost: number;
                        readonly tokens: {
                            readonly input: number;
                            readonly output: number;
                            readonly reasoning: number;
                            readonly cache: {
                                readonly read: number;
                                readonly write: number;
                            };
                        };
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly updated: import("effect/DateTime").Utc;
                            readonly compacting?: import("effect/DateTime").Utc | undefined;
                            readonly archived?: import("effect/DateTime").Utc | undefined;
                        };
                        readonly title: string;
                        readonly metadata?: {
                            readonly [x: string]: Schema.Json;
                        } | undefined;
                        readonly share?: {
                            readonly url: string;
                        } | undefined;
                        readonly permission?: readonly {
                            readonly action: string;
                            readonly resource: string;
                            readonly effect: "allow" | "ask" | "deny";
                        }[] | undefined;
                        readonly location: {
                            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                            readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                        };
                        readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                        readonly revert?: {
                            readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                            readonly partID?: string | undefined;
                            readonly contentIndex?: number | undefined;
                            readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                            readonly snapshot?: string | undefined;
                            readonly diff?: string | undefined;
                            readonly files?: readonly {
                                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                                readonly status: "added" | "deleted" | "modified";
                                readonly additions: number;
                                readonly deletions: number;
                                readonly patch: string;
                            }[] | undefined;
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.deleted";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly info: {
                        readonly id: string & import("effect/Brand").Brand<"SessionID">;
                        readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                        readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                        readonly slug: string;
                        readonly version: string;
                        readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                        readonly model?: {
                            readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                            readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                            readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                            readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                        } | undefined;
                        readonly cost: number;
                        readonly tokens: {
                            readonly input: number;
                            readonly output: number;
                            readonly reasoning: number;
                            readonly cache: {
                                readonly read: number;
                                readonly write: number;
                            };
                        };
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly updated: import("effect/DateTime").Utc;
                            readonly compacting?: import("effect/DateTime").Utc | undefined;
                            readonly archived?: import("effect/DateTime").Utc | undefined;
                        };
                        readonly title: string;
                        readonly metadata?: {
                            readonly [x: string]: Schema.Json;
                        } | undefined;
                        readonly share?: {
                            readonly url: string;
                        } | undefined;
                        readonly permission?: readonly {
                            readonly action: string;
                            readonly resource: string;
                            readonly effect: "allow" | "ask" | "deny";
                        }[] | undefined;
                        readonly location: {
                            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                            readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                        };
                        readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                        readonly revert?: {
                            readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                            readonly partID?: string | undefined;
                            readonly contentIndex?: number | undefined;
                            readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                            readonly snapshot?: string | undefined;
                            readonly diff?: string | undefined;
                            readonly files?: readonly {
                                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                                readonly status: "added" | "deleted" | "modified";
                                readonly additions: number;
                                readonly deletions: number;
                                readonly patch: string;
                            }[] | undefined;
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.status";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly status: {
                        readonly type: "idle";
                    } | {
                        readonly type: "retry";
                        readonly attempt: number;
                        readonly message: string;
                        readonly action?: {
                            readonly reason: string;
                            readonly provider: string;
                            readonly title: string;
                            readonly message: string;
                            readonly label: string;
                            readonly link?: string | undefined;
                        } | undefined;
                        readonly next: number;
                    } | {
                        readonly type: "busy";
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.diff";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly diff: readonly {
                        readonly file?: string | undefined;
                        readonly patch?: string | undefined;
                        readonly additions: number;
                        readonly deletions: number;
                        readonly status?: "added" | "deleted" | "modified" | undefined;
                    }[];
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.agent.switched";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly agent: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.model.switched";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly model: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.moved";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subdirectory?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.message.imported";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly message: {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                        };
                        readonly type: "agent-switched";
                        readonly agent: string;
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                        };
                        readonly type: "model-switched";
                        readonly model: {
                            readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                            readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                            readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                            readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                        };
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                        };
                        readonly text: string;
                        readonly context?: readonly {
                            readonly text: string;
                            readonly metadata?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        }[] | undefined;
                        readonly files?: readonly {
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                            readonly materialized?: readonly ({
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            })[] | undefined;
                        }[] | undefined;
                        readonly agents?: readonly {
                            readonly name: string;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly guidance?: string | undefined;
                        }[] | undefined;
                        readonly system?: string | undefined;
                        readonly tools?: {
                            readonly [x: string]: boolean;
                        } | undefined;
                        readonly format?: {
                            readonly type: "text";
                        } | {
                            readonly type: "json_schema";
                            readonly schema: {
                                readonly [x: string]: unknown;
                            };
                            readonly retryCount?: number | undefined;
                        } | undefined;
                        readonly type: "user";
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                        };
                        readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                        readonly text: string;
                        readonly description?: string | undefined;
                        readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
                        readonly type: "synthetic";
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                        };
                        readonly type: "system";
                        readonly text: string;
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly type: "shell";
                        readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                        readonly callID: string;
                        readonly command: string;
                        readonly output: string;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                        };
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly type: "assistant";
                        readonly agent: string;
                        readonly model: {
                            readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                            readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                            readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                            readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly id: string;
                            readonly text: string;
                        } | {
                            readonly type: "reasoning";
                            readonly id: string;
                            readonly text: string;
                            readonly providerMetadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                            readonly time?: {
                                readonly created: import("effect/DateTime").Utc;
                                readonly completed?: import("effect/DateTime").Utc | undefined;
                            } | undefined;
                        } | {
                            readonly type: "tool";
                            readonly id: string;
                            readonly name: string;
                            readonly provider?: {
                                readonly executed: boolean;
                                readonly metadata?: {
                                    readonly [x: string]: {
                                        readonly [x: string]: unknown;
                                    };
                                } | undefined;
                                readonly resultMetadata?: {
                                    readonly [x: string]: {
                                        readonly [x: string]: unknown;
                                    };
                                } | undefined;
                            } | undefined;
                            readonly state: {
                                readonly status: "pending";
                                readonly input: string;
                            } | {
                                readonly status: "running";
                                readonly input: {
                                    readonly [x: string]: unknown;
                                };
                                readonly structured: {
                                    readonly [x: string]: unknown;
                                };
                                readonly content: readonly ({
                                    readonly type: "text";
                                    readonly text: string;
                                    readonly provenance?: {
                                        readonly type: "mcp";
                                        readonly clientName: string;
                                        readonly uri: string;
                                        readonly kind: "resource" | "resource_link";
                                        readonly mime?: string | undefined;
                                        readonly name?: string | undefined;
                                        readonly description?: string | undefined;
                                        readonly size?: number | undefined;
                                        readonly annotations?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                        readonly meta?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                    } | undefined;
                                } | {
                                    readonly type: "file";
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                    readonly provenance?: {
                                        readonly type: "mcp";
                                        readonly clientName: string;
                                        readonly uri: string;
                                        readonly kind: "resource" | "resource_link";
                                        readonly mime?: string | undefined;
                                        readonly name?: string | undefined;
                                        readonly description?: string | undefined;
                                        readonly size?: number | undefined;
                                        readonly annotations?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                        readonly meta?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                    } | undefined;
                                })[];
                            } | {
                                readonly status: "completed";
                                readonly input: {
                                    readonly [x: string]: unknown;
                                };
                                readonly attachments?: readonly {
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly source?: {
                                        readonly start: number;
                                        readonly end: number;
                                        readonly text: string;
                                    } | undefined;
                                    readonly resource?: {
                                        readonly clientName: string;
                                        readonly uri: string;
                                    } | undefined;
                                    readonly materialized?: readonly ({
                                        readonly type: "text";
                                        readonly text: string;
                                    } | {
                                        readonly type: "file";
                                        readonly uri: string;
                                        readonly mime: string;
                                        readonly name?: string | undefined;
                                    } | {
                                        readonly type: "error";
                                        readonly message: string;
                                    })[] | undefined;
                                }[] | undefined;
                                readonly content: readonly ({
                                    readonly type: "text";
                                    readonly text: string;
                                    readonly provenance?: {
                                        readonly type: "mcp";
                                        readonly clientName: string;
                                        readonly uri: string;
                                        readonly kind: "resource" | "resource_link";
                                        readonly mime?: string | undefined;
                                        readonly name?: string | undefined;
                                        readonly description?: string | undefined;
                                        readonly size?: number | undefined;
                                        readonly annotations?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                        readonly meta?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                    } | undefined;
                                } | {
                                    readonly type: "file";
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                    readonly provenance?: {
                                        readonly type: "mcp";
                                        readonly clientName: string;
                                        readonly uri: string;
                                        readonly kind: "resource" | "resource_link";
                                        readonly mime?: string | undefined;
                                        readonly name?: string | undefined;
                                        readonly description?: string | undefined;
                                        readonly size?: number | undefined;
                                        readonly annotations?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                        readonly meta?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                    } | undefined;
                                })[];
                                readonly outputPaths?: readonly string[] | undefined;
                                readonly structured: {
                                    readonly [x: string]: unknown;
                                };
                                readonly result?: unknown;
                            } | {
                                readonly status: "error";
                                readonly input: {
                                    readonly [x: string]: unknown;
                                };
                                readonly content: readonly ({
                                    readonly type: "text";
                                    readonly text: string;
                                    readonly provenance?: {
                                        readonly type: "mcp";
                                        readonly clientName: string;
                                        readonly uri: string;
                                        readonly kind: "resource" | "resource_link";
                                        readonly mime?: string | undefined;
                                        readonly name?: string | undefined;
                                        readonly description?: string | undefined;
                                        readonly size?: number | undefined;
                                        readonly annotations?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                        readonly meta?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                    } | undefined;
                                } | {
                                    readonly type: "file";
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                    readonly provenance?: {
                                        readonly type: "mcp";
                                        readonly clientName: string;
                                        readonly uri: string;
                                        readonly kind: "resource" | "resource_link";
                                        readonly mime?: string | undefined;
                                        readonly name?: string | undefined;
                                        readonly description?: string | undefined;
                                        readonly size?: number | undefined;
                                        readonly annotations?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                        readonly meta?: {
                                            readonly [x: string]: unknown;
                                        } | undefined;
                                    } | undefined;
                                })[];
                                readonly structured: {
                                    readonly [x: string]: unknown;
                                };
                                readonly error: {
                                    readonly type: "unknown";
                                    readonly message: string;
                                };
                                readonly result?: unknown;
                            };
                            readonly time: {
                                readonly created: import("effect/DateTime").Utc;
                                readonly ran?: import("effect/DateTime").Utc | undefined;
                                readonly completed?: import("effect/DateTime").Utc | undefined;
                                readonly pruned?: import("effect/DateTime").Utc | undefined;
                            };
                        })[];
                        readonly snapshot?: {
                            readonly start?: string | undefined;
                            readonly end?: string | undefined;
                            readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                            readonly patch?: readonly {
                                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                                readonly status: "added" | "deleted" | "modified";
                                readonly additions: number;
                                readonly deletions: number;
                                readonly patch: string;
                            }[] | undefined;
                        } | undefined;
                        readonly finish?: string | undefined;
                        readonly structured?: unknown;
                        readonly cost?: number | undefined;
                        readonly tokens?: {
                            readonly input: number;
                            readonly output: number;
                            readonly reasoning: number;
                            readonly cache: {
                                readonly read: number;
                                readonly write: number;
                            };
                        } | undefined;
                        readonly error?: {
                            readonly type: "unknown";
                            readonly message: string;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                        };
                    } | {
                        readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                        };
                        readonly type: "compaction";
                        readonly reason: "auto" | "manual";
                        readonly summary: string;
                        readonly recent: string;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.transcript.message.removed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.transcript.user-text.updated";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly partID: string;
                    readonly text: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.transcript.user-text.removed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly partID: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.transcript.content.updated";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly contentIndex: number;
                    readonly partID: string;
                    readonly content: {
                        readonly type: "text";
                        readonly id: string;
                        readonly text: string;
                    } | {
                        readonly type: "reasoning";
                        readonly id: string;
                        readonly text: string;
                        readonly providerMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                        readonly time?: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                        } | undefined;
                    } | {
                        readonly type: "tool";
                        readonly id: string;
                        readonly name: string;
                        readonly provider?: {
                            readonly executed: boolean;
                            readonly metadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                            readonly resultMetadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                        } | undefined;
                        readonly state: {
                            readonly status: "pending";
                            readonly input: string;
                        } | {
                            readonly status: "running";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                        } | {
                            readonly status: "completed";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly attachments?: readonly {
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly source?: {
                                    readonly start: number;
                                    readonly end: number;
                                    readonly text: string;
                                } | undefined;
                                readonly resource?: {
                                    readonly clientName: string;
                                    readonly uri: string;
                                } | undefined;
                                readonly materialized?: readonly ({
                                    readonly type: "text";
                                    readonly text: string;
                                } | {
                                    readonly type: "file";
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                } | {
                                    readonly type: "error";
                                    readonly message: string;
                                })[] | undefined;
                            }[] | undefined;
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                            readonly outputPaths?: readonly string[] | undefined;
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly result?: unknown;
                        } | {
                            readonly status: "error";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly error: {
                                readonly type: "unknown";
                                readonly message: string;
                            };
                            readonly result?: unknown;
                        };
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly ran?: import("effect/DateTime").Utc | undefined;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                            readonly pruned?: import("effect/DateTime").Utc | undefined;
                        };
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.transcript.content.removed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly contentIndex: number;
                    readonly partID: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.prompted";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly prompt: {
                        readonly text: string;
                        readonly context?: readonly {
                            readonly text: string;
                            readonly metadata?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        }[] | undefined;
                        readonly files?: readonly {
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                            readonly materialized?: readonly ({
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            })[] | undefined;
                        }[] | undefined;
                        readonly agents?: readonly {
                            readonly name: string;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly guidance?: string | undefined;
                        }[] | undefined;
                        readonly system?: string | undefined;
                        readonly tools?: {
                            readonly [x: string]: boolean;
                        } | undefined;
                        readonly format?: {
                            readonly type: "text";
                        } | {
                            readonly type: "json_schema";
                            readonly schema: {
                                readonly [x: string]: unknown;
                            };
                            readonly retryCount?: number | undefined;
                        } | undefined;
                    };
                    readonly synthetic?: {
                        readonly description: string;
                        readonly scope?: "session" | "turn" | undefined;
                    } | undefined;
                    readonly delivery: "queue" | "steer";
                    readonly intent?: {
                        readonly type: "start";
                    } | {
                        readonly type: "steer";
                        readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    } | {
                        readonly type: "queue";
                    } | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.prompt.admitted";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly prompt: {
                        readonly text: string;
                        readonly context?: readonly {
                            readonly text: string;
                            readonly metadata?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        }[] | undefined;
                        readonly files?: readonly {
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                            readonly materialized?: readonly ({
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            })[] | undefined;
                        }[] | undefined;
                        readonly agents?: readonly {
                            readonly name: string;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly guidance?: string | undefined;
                        }[] | undefined;
                        readonly system?: string | undefined;
                        readonly tools?: {
                            readonly [x: string]: boolean;
                        } | undefined;
                        readonly format?: {
                            readonly type: "text";
                        } | {
                            readonly type: "json_schema";
                            readonly schema: {
                                readonly [x: string]: unknown;
                            };
                            readonly retryCount?: number | undefined;
                        } | undefined;
                    };
                    readonly synthetic?: {
                        readonly description: string;
                        readonly scope?: "session" | "turn" | undefined;
                    } | undefined;
                    readonly delivery: "queue" | "steer";
                    readonly intent?: {
                        readonly type: "start";
                    } | {
                        readonly type: "steer";
                        readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    } | {
                        readonly type: "queue";
                    } | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.turn.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly turnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.turn.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly turnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly outcome?: "abandoned" | "completed" | "failed" | "interrupted" | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.context.updated";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly text: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.synthetic";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly text: string;
                    readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.shell.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                    readonly callID: string;
                    readonly command: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.shell.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly callID: string;
                    readonly output: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.step.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly agent: string;
                    readonly model: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                    readonly snapshot?: string | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.step.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly finish: string;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly snapshot?: string | undefined;
                    readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                    readonly patch?: readonly {
                        readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                        readonly status: "added" | "deleted" | "modified";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }[] | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.step.failed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.text.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly textID: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.text.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly textID: string;
                    readonly text: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.reasoning.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly reasoningID: string;
                    readonly providerMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.reasoning.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly reasoningID: string;
                    readonly text: string;
                    readonly providerMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool.input.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly name: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool.input.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly text: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool.called";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly tool: string;
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly provider: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool.progress";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool.success";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly outputPaths?: readonly string[] | undefined;
                    readonly result?: unknown;
                    readonly provider: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool.failed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                    readonly result?: unknown;
                    readonly provider: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.tool-discovery.completed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly callID: string;
                    readonly query: string;
                    readonly limit: number;
                    readonly catalogRevision: string;
                    readonly matches: readonly {
                        readonly key: string & import("effect/Brand").Brand<"ToolCatalog.Key">;
                        readonly callableName: string;
                        readonly definitionHash: string;
                        readonly source: {
                            readonly type: "app" | "builtin" | "mcp" | "plugin";
                            readonly id: string;
                            readonly displayName?: string | undefined;
                        };
                    }[];
                    readonly pendingSources: readonly {
                        readonly type: "app" | "builtin" | "mcp" | "plugin";
                        readonly id: string;
                        readonly displayName?: string | undefined;
                    }[];
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.provider.attempt.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly attempt: number;
                    readonly retryOf?: (string & import("effect/Brand").Brand<"Event.ID">) | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.provider.attempt.response.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.provider.attempt.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                    readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly outcome: "abandoned" | "completed" | "failed" | "interrupted";
                    readonly continuation: boolean;
                    readonly error?: {
                        readonly type: "unknown";
                        readonly message: string;
                    } | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.provider.recovery.decided";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                    readonly decision: "abandon" | "retry";
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.retried";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                    readonly attempt: number;
                    readonly next: import("effect/DateTime").Utc;
                    readonly error: {
                        readonly message: string;
                        readonly statusCode?: number | undefined;
                        readonly isRetryable: boolean;
                        readonly responseHeaders?: {
                            readonly [x: string]: string;
                        } | undefined;
                        readonly responseBody?: string | undefined;
                        readonly metadata?: {
                            readonly [x: string]: string;
                        } | undefined;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.compaction.started";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly reason: "auto" | "manual";
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.compaction.ended";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly reason: "auto" | "manual";
                    readonly text: string;
                    readonly recent: string;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.compaction.failed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly reason: "auto" | "manual";
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.revert.cleared";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.revert.committed";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly partID?: string | undefined;
                    readonly contentIndex?: number | undefined;
                    readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Event.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "session.next.revert.staged";
                readonly durable?: {
                    readonly aggregateID: string;
                    readonly seq: number;
                    readonly version: number;
                } | undefined;
                readonly location?: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                } | undefined;
                readonly data: {
                    readonly timestamp: import("effect/DateTime").Utc;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly revert: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    };
                };
            })[];
            readonly hasMore: boolean;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        events: (input: Endpoint4_29Input) => Stream.Stream<{
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.created";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly slug: string;
                    readonly version: string;
                    readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly updated: import("effect/DateTime").Utc;
                        readonly compacting?: import("effect/DateTime").Utc | undefined;
                        readonly archived?: import("effect/DateTime").Utc | undefined;
                    };
                    readonly title: string;
                    readonly metadata?: {
                        readonly [x: string]: Schema.Json;
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly permission?: readonly {
                        readonly action: string;
                        readonly resource: string;
                        readonly effect: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly slug: string;
                    readonly version: string;
                    readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly updated: import("effect/DateTime").Utc;
                        readonly compacting?: import("effect/DateTime").Utc | undefined;
                        readonly archived?: import("effect/DateTime").Utc | undefined;
                    };
                    readonly title: string;
                    readonly metadata?: {
                        readonly [x: string]: Schema.Json;
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly permission?: readonly {
                        readonly action: string;
                        readonly resource: string;
                        readonly effect: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.deleted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly slug: string;
                    readonly version: string;
                    readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly updated: import("effect/DateTime").Utc;
                        readonly compacting?: import("effect/DateTime").Utc | undefined;
                        readonly archived?: import("effect/DateTime").Utc | undefined;
                    };
                    readonly title: string;
                    readonly metadata?: {
                        readonly [x: string]: Schema.Json;
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly permission?: readonly {
                        readonly action: string;
                        readonly resource: string;
                        readonly effect: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.status";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly status: {
                    readonly type: "idle";
                } | {
                    readonly type: "retry";
                    readonly attempt: number;
                    readonly message: string;
                    readonly action?: {
                        readonly reason: string;
                        readonly provider: string;
                        readonly title: string;
                        readonly message: string;
                        readonly label: string;
                        readonly link?: string | undefined;
                    } | undefined;
                    readonly next: number;
                } | {
                    readonly type: "busy";
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.diff";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly diff: readonly {
                    readonly file?: string | undefined;
                    readonly patch?: string | undefined;
                    readonly additions: number;
                    readonly deletions: number;
                    readonly status?: "added" | "deleted" | "modified" | undefined;
                }[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.agent.switched";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly agent: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.model.switched";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly model: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.moved";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly location: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                };
                readonly subdirectory?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.message.imported";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly message: {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "agent-switched";
                    readonly agent: string;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "model-switched";
                    readonly model: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly text: string;
                    readonly context?: readonly {
                        readonly text: string;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    }[] | undefined;
                    readonly files?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly agents?: readonly {
                        readonly name: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly guidance?: string | undefined;
                    }[] | undefined;
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: unknown;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
                    readonly type: "user";
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly text: string;
                    readonly description?: string | undefined;
                    readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
                    readonly type: "synthetic";
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "system";
                    readonly text: string;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly type: "shell";
                    readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                    readonly callID: string;
                    readonly command: string;
                    readonly output: string;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly type: "assistant";
                    readonly agent: string;
                    readonly model: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly id: string;
                        readonly text: string;
                    } | {
                        readonly type: "reasoning";
                        readonly id: string;
                        readonly text: string;
                        readonly providerMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                        readonly time?: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                        } | undefined;
                    } | {
                        readonly type: "tool";
                        readonly id: string;
                        readonly name: string;
                        readonly provider?: {
                            readonly executed: boolean;
                            readonly metadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                            readonly resultMetadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                        } | undefined;
                        readonly state: {
                            readonly status: "pending";
                            readonly input: string;
                        } | {
                            readonly status: "running";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                        } | {
                            readonly status: "completed";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly attachments?: readonly {
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly source?: {
                                    readonly start: number;
                                    readonly end: number;
                                    readonly text: string;
                                } | undefined;
                                readonly resource?: {
                                    readonly clientName: string;
                                    readonly uri: string;
                                } | undefined;
                                readonly materialized?: readonly ({
                                    readonly type: "text";
                                    readonly text: string;
                                } | {
                                    readonly type: "file";
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                } | {
                                    readonly type: "error";
                                    readonly message: string;
                                })[] | undefined;
                            }[] | undefined;
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                            readonly outputPaths?: readonly string[] | undefined;
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly result?: unknown;
                        } | {
                            readonly status: "error";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly error: {
                                readonly type: "unknown";
                                readonly message: string;
                            };
                            readonly result?: unknown;
                        };
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly ran?: import("effect/DateTime").Utc | undefined;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                            readonly pruned?: import("effect/DateTime").Utc | undefined;
                        };
                    })[];
                    readonly snapshot?: {
                        readonly start?: string | undefined;
                        readonly end?: string | undefined;
                        readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                        readonly patch?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                    readonly finish?: string | undefined;
                    readonly structured?: unknown;
                    readonly cost?: number | undefined;
                    readonly tokens?: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    } | undefined;
                    readonly error?: {
                        readonly type: "unknown";
                        readonly message: string;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "compaction";
                    readonly reason: "auto" | "manual";
                    readonly summary: string;
                    readonly recent: string;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.message.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.user-text.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID: string;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.user-text.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.content.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly contentIndex: number;
                readonly partID: string;
                readonly content: {
                    readonly type: "text";
                    readonly id: string;
                    readonly text: string;
                } | {
                    readonly type: "reasoning";
                    readonly id: string;
                    readonly text: string;
                    readonly providerMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                    readonly time?: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    } | undefined;
                } | {
                    readonly type: "tool";
                    readonly id: string;
                    readonly name: string;
                    readonly provider?: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                        readonly resultMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                    } | undefined;
                    readonly state: {
                        readonly status: "pending";
                        readonly input: string;
                    } | {
                        readonly status: "running";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                    } | {
                        readonly status: "completed";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly attachments?: readonly {
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                            readonly materialized?: readonly ({
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            })[] | undefined;
                        }[] | undefined;
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                        readonly outputPaths?: readonly string[] | undefined;
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly result?: unknown;
                    } | {
                        readonly status: "error";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly error: {
                            readonly type: "unknown";
                            readonly message: string;
                        };
                        readonly result?: unknown;
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly ran?: import("effect/DateTime").Utc | undefined;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                        readonly pruned?: import("effect/DateTime").Utc | undefined;
                    };
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.content.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly contentIndex: number;
                readonly partID: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.prompted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly prompt: {
                    readonly text: string;
                    readonly context?: readonly {
                        readonly text: string;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    }[] | undefined;
                    readonly files?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly agents?: readonly {
                        readonly name: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly guidance?: string | undefined;
                    }[] | undefined;
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: unknown;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
                };
                readonly synthetic?: {
                    readonly description: string;
                    readonly scope?: "session" | "turn" | undefined;
                } | undefined;
                readonly delivery: "queue" | "steer";
                readonly intent?: {
                    readonly type: "start";
                } | {
                    readonly type: "steer";
                    readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                } | {
                    readonly type: "queue";
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.prompt.admitted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly prompt: {
                    readonly text: string;
                    readonly context?: readonly {
                        readonly text: string;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    }[] | undefined;
                    readonly files?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly agents?: readonly {
                        readonly name: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly guidance?: string | undefined;
                    }[] | undefined;
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: unknown;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
                };
                readonly synthetic?: {
                    readonly description: string;
                    readonly scope?: "session" | "turn" | undefined;
                } | undefined;
                readonly delivery: "queue" | "steer";
                readonly intent?: {
                    readonly type: "start";
                } | {
                    readonly type: "steer";
                    readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                } | {
                    readonly type: "queue";
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.turn.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly turnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.turn.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly turnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly outcome?: "abandoned" | "completed" | "failed" | "interrupted" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.context.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.synthetic";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly text: string;
                readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.shell.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                readonly callID: string;
                readonly command: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.shell.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly callID: string;
                readonly output: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.step.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly agent: string;
                readonly model: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
                readonly snapshot?: string | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.step.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly finish: string;
                readonly cost: number;
                readonly tokens: {
                    readonly input: number;
                    readonly output: number;
                    readonly reasoning: number;
                    readonly cache: {
                        readonly read: number;
                        readonly write: number;
                    };
                };
                readonly snapshot?: string | undefined;
                readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                readonly patch?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.step.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.text.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly textID: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.text.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly textID: string;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.reasoning.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reasoningID: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.reasoning.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reasoningID: string;
                readonly text: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.input.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly name: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.input.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.called";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly tool: string;
                readonly input: {
                    readonly [x: string]: unknown;
                };
                readonly provider: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.progress";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly structured: {
                    readonly [x: string]: unknown;
                };
                readonly content: readonly ({
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                })[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.success";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly structured: {
                    readonly [x: string]: unknown;
                };
                readonly content: readonly ({
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                })[];
                readonly outputPaths?: readonly string[] | undefined;
                readonly result?: unknown;
                readonly provider: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
                readonly result?: unknown;
                readonly provider: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool-discovery.completed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly query: string;
                readonly limit: number;
                readonly catalogRevision: string;
                readonly matches: readonly {
                    readonly key: string & import("effect/Brand").Brand<"ToolCatalog.Key">;
                    readonly callableName: string;
                    readonly definitionHash: string;
                    readonly source: {
                        readonly type: "app" | "builtin" | "mcp" | "plugin";
                        readonly id: string;
                        readonly displayName?: string | undefined;
                    };
                }[];
                readonly pendingSources: readonly {
                    readonly type: "app" | "builtin" | "mcp" | "plugin";
                    readonly id: string;
                    readonly displayName?: string | undefined;
                }[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.attempt.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly attempt: number;
                readonly retryOf?: (string & import("effect/Brand").Brand<"Event.ID">) | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.attempt.response.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.attempt.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly outcome: "abandoned" | "completed" | "failed" | "interrupted";
                readonly continuation: boolean;
                readonly error?: {
                    readonly type: "unknown";
                    readonly message: string;
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.recovery.decided";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly decision: "abandon" | "retry";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.retried";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly attempt: number;
                readonly next: import("effect/DateTime").Utc;
                readonly error: {
                    readonly message: string;
                    readonly statusCode?: number | undefined;
                    readonly isRetryable: boolean;
                    readonly responseHeaders?: {
                        readonly [x: string]: string;
                    } | undefined;
                    readonly responseBody?: string | undefined;
                    readonly metadata?: {
                        readonly [x: string]: string;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reason: "auto" | "manual";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reason: "auto" | "manual";
                readonly text: string;
                readonly recent: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reason: "auto" | "manual";
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.revert.cleared";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.revert.committed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.revert.staged";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly revert: {
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly partID?: string | undefined;
                    readonly contentIndex?: number | undefined;
                    readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                    readonly snapshot?: string | undefined;
                    readonly diff?: string | undefined;
                    readonly files?: readonly {
                        readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                        readonly status: "added" | "deleted" | "modified";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }[] | undefined;
                };
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Sse.Retry | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        interrupt: (input: Endpoint4_30Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        message: (input: Endpoint4_31Input) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "agent-switched";
            readonly agent: string;
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "model-switched";
            readonly model: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly text: string;
            readonly context?: readonly {
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
            }[] | undefined;
            readonly files?: readonly {
                readonly uri: string;
                readonly mime: string;
                readonly name?: string | undefined;
                readonly description?: string | undefined;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                } | undefined;
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                } | undefined;
                readonly materialized?: readonly ({
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                } | {
                    readonly type: "error";
                    readonly message: string;
                })[] | undefined;
            }[] | undefined;
            readonly agents?: readonly {
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                } | undefined;
                readonly guidance?: string | undefined;
            }[] | undefined;
            readonly system?: string | undefined;
            readonly tools?: {
                readonly [x: string]: boolean;
            } | undefined;
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: unknown;
                };
                readonly retryCount?: number | undefined;
            } | undefined;
            readonly type: "user";
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly text: string;
            readonly description?: string | undefined;
            readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            readonly type: "synthetic";
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "system";
            readonly text: string;
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "shell";
            readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
            readonly callID: string;
            readonly command: string;
            readonly output: string;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly completed?: import("effect/DateTime").Utc | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "assistant";
            readonly agent: string;
            readonly model: {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            };
            readonly content: readonly ({
                readonly type: "text";
                readonly id: string;
                readonly text: string;
            } | {
                readonly type: "reasoning";
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
                readonly time?: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly completed?: import("effect/DateTime").Utc | undefined;
                } | undefined;
            } | {
                readonly type: "tool";
                readonly id: string;
                readonly name: string;
                readonly provider?: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                    readonly resultMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                } | undefined;
                readonly state: {
                    readonly status: "pending";
                    readonly input: string;
                } | {
                    readonly status: "running";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                } | {
                    readonly status: "completed";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly attachments?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly outputPaths?: readonly string[] | undefined;
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly result?: unknown;
                } | {
                    readonly status: "error";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string | undefined;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly size?: number | undefined;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                    readonly result?: unknown;
                };
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly ran?: import("effect/DateTime").Utc | undefined;
                    readonly completed?: import("effect/DateTime").Utc | undefined;
                    readonly pruned?: import("effect/DateTime").Utc | undefined;
                };
            })[];
            readonly snapshot?: {
                readonly start?: string | undefined;
                readonly end?: string | undefined;
                readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                readonly patch?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
            readonly finish?: string | undefined;
            readonly structured?: unknown;
            readonly cost?: number | undefined;
            readonly tokens?: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            } | undefined;
            readonly error?: {
                readonly type: "unknown";
                readonly message: string;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
                readonly completed?: import("effect/DateTime").Utc | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly time: {
                readonly created: import("effect/DateTime").Utc;
            };
            readonly type: "compaction";
            readonly reason: "auto" | "manual";
            readonly summary: string;
            readonly recent: string;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").MessageNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    messages: {
        list: (input: Endpoint5_0Input) => Effect.Effect<{
            readonly data: readonly ({
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                };
                readonly type: "agent-switched";
                readonly agent: string;
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                };
                readonly type: "model-switched";
                readonly model: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                };
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                }[] | undefined;
                readonly files?: readonly {
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly description?: string | undefined;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                    readonly materialized?: readonly ({
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    })[] | undefined;
                }[] | undefined;
                readonly agents?: readonly {
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    } | undefined;
                    readonly guidance?: string | undefined;
                }[] | undefined;
                readonly system?: string | undefined;
                readonly tools?: {
                    readonly [x: string]: boolean;
                } | undefined;
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: unknown;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
                readonly type: "user";
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                };
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly text: string;
                readonly description?: string | undefined;
                readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
                readonly type: "synthetic";
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                };
                readonly type: "system";
                readonly text: string;
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "shell";
                readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                readonly callID: string;
                readonly command: string;
                readonly output: string;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly completed?: import("effect/DateTime").Utc | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly type: "assistant";
                readonly agent: string;
                readonly model: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
                readonly content: readonly ({
                    readonly type: "text";
                    readonly id: string;
                    readonly text: string;
                } | {
                    readonly type: "reasoning";
                    readonly id: string;
                    readonly text: string;
                    readonly providerMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                    readonly time?: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    } | undefined;
                } | {
                    readonly type: "tool";
                    readonly id: string;
                    readonly name: string;
                    readonly provider?: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                        readonly resultMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                    } | undefined;
                    readonly state: {
                        readonly status: "pending";
                        readonly input: string;
                    } | {
                        readonly status: "running";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                    } | {
                        readonly status: "completed";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly attachments?: readonly {
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                            readonly materialized?: readonly ({
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            })[] | undefined;
                        }[] | undefined;
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                        readonly outputPaths?: readonly string[] | undefined;
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly result?: unknown;
                    } | {
                        readonly status: "error";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly error: {
                            readonly type: "unknown";
                            readonly message: string;
                        };
                        readonly result?: unknown;
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly ran?: import("effect/DateTime").Utc | undefined;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                        readonly pruned?: import("effect/DateTime").Utc | undefined;
                    };
                })[];
                readonly snapshot?: {
                    readonly start?: string | undefined;
                    readonly end?: string | undefined;
                    readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                    readonly patch?: readonly {
                        readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                        readonly status: "added" | "deleted" | "modified";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }[] | undefined;
                } | undefined;
                readonly finish?: string | undefined;
                readonly structured?: unknown;
                readonly cost?: number | undefined;
                readonly tokens?: {
                    readonly input: number;
                    readonly output: number;
                    readonly reasoning: number;
                    readonly cache: {
                        readonly read: number;
                        readonly write: number;
                    };
                } | undefined;
                readonly error?: {
                    readonly type: "unknown";
                    readonly message: string;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                    readonly completed?: import("effect/DateTime").Utc | undefined;
                };
            } | {
                readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly time: {
                    readonly created: import("effect/DateTime").Utc;
                };
                readonly type: "compaction";
                readonly reason: "auto" | "manual";
                readonly summary: string;
                readonly recent: string;
            })[];
            readonly cursor: {
                readonly previous?: string | undefined;
                readonly next?: string | undefined;
            };
            readonly watermark?: number | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidCursorError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/errors").UnknownError, never>;
    };
    models: {
        list: (input?: Endpoint6_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly family?: (string & import("effect/Brand").Brand<"Family">) | undefined;
                readonly name: string;
                readonly api: {
                    readonly type: "aisdk";
                    readonly package: string;
                    readonly url?: string | undefined;
                    readonly settings?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                } | {
                    readonly type: "native";
                    readonly url?: string | undefined;
                    readonly settings: {
                        readonly [x: string]: unknown;
                    };
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                };
                readonly capabilities: {
                    readonly tools: boolean;
                    readonly input: readonly string[];
                    readonly output: readonly string[];
                    readonly temperature?: boolean | undefined;
                    readonly reasoning?: boolean | undefined;
                    readonly attachment?: boolean | undefined;
                    readonly interleaved?: boolean | {
                        readonly field: "reasoning" | "reasoning_content" | "reasoning_details";
                    } | undefined;
                };
                readonly request: {
                    readonly headers: {
                        readonly [x: string]: string;
                    };
                    readonly body: {
                        readonly [x: string]: Schema.Json;
                    };
                    readonly variant?: string | undefined;
                };
                readonly variants: readonly {
                    readonly headers: {
                        readonly [x: string]: string;
                    };
                    readonly body: {
                        readonly [x: string]: Schema.Json;
                    };
                    readonly id: string & import("effect/Brand").Brand<"VariantID">;
                }[];
                readonly protocols?: readonly ("anthropic-messages" | "openai-compatible" | "openai-responses")[] | undefined;
                readonly time: {
                    readonly released: number;
                };
                readonly cost: readonly {
                    readonly tier?: {
                        readonly type: "context";
                        readonly size: number;
                    } | undefined;
                    readonly input: number;
                    readonly output: number;
                    readonly cache: {
                        readonly read: number;
                        readonly write: number;
                    };
                }[];
                readonly status: "active" | "alpha" | "beta" | "deprecated";
                readonly enabled: boolean;
                readonly limit: {
                    readonly context: number;
                    readonly input?: number | undefined;
                    readonly output: number;
                };
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    providers: {
        catalog: (input?: Endpoint7_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly providers: readonly {
                    readonly info: {
                        readonly id: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly integrationID?: (string & import("effect/Brand").Brand<"Integration.ID">) | undefined;
                        readonly name: string;
                        readonly disabled?: boolean | undefined;
                        readonly api: {
                            readonly type: "aisdk";
                            readonly package: string;
                            readonly url?: string | undefined;
                            readonly settings?: {
                                readonly [x: string]: unknown;
                            } | undefined;
                        } | {
                            readonly type: "native";
                            readonly url?: string | undefined;
                            readonly settings: {
                                readonly [x: string]: unknown;
                            };
                        };
                        readonly request: {
                            readonly headers: {
                                readonly [x: string]: string;
                            };
                            readonly body: {
                                readonly [x: string]: Schema.Json;
                            };
                        };
                    };
                    readonly source: "api" | "config" | "custom" | "env";
                    readonly auth?: "env" | "key" | "oauth" | undefined;
                    readonly env: readonly string[];
                }[];
                readonly models: readonly {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly family?: (string & import("effect/Brand").Brand<"Family">) | undefined;
                    readonly name: string;
                    readonly api: {
                        readonly type: "aisdk";
                        readonly package: string;
                        readonly url?: string | undefined;
                        readonly settings?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    } | {
                        readonly type: "native";
                        readonly url?: string | undefined;
                        readonly settings: {
                            readonly [x: string]: unknown;
                        };
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    };
                    readonly capabilities: {
                        readonly tools: boolean;
                        readonly input: readonly string[];
                        readonly output: readonly string[];
                        readonly temperature?: boolean | undefined;
                        readonly reasoning?: boolean | undefined;
                        readonly attachment?: boolean | undefined;
                        readonly interleaved?: boolean | {
                            readonly field: "reasoning" | "reasoning_content" | "reasoning_details";
                        } | undefined;
                    };
                    readonly request: {
                        readonly headers: {
                            readonly [x: string]: string;
                        };
                        readonly body: {
                            readonly [x: string]: Schema.Json;
                        };
                        readonly variant?: string | undefined;
                    };
                    readonly variants: readonly {
                        readonly headers: {
                            readonly [x: string]: string;
                        };
                        readonly body: {
                            readonly [x: string]: Schema.Json;
                        };
                        readonly id: string & import("effect/Brand").Brand<"VariantID">;
                    }[];
                    readonly protocols?: readonly ("anthropic-messages" | "openai-compatible" | "openai-responses")[] | undefined;
                    readonly time: {
                        readonly released: number;
                    };
                    readonly cost: readonly {
                        readonly tier?: {
                            readonly type: "context";
                            readonly size: number;
                        } | undefined;
                        readonly input: number;
                        readonly output: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    }[];
                    readonly status: "active" | "alpha" | "beta" | "deprecated";
                    readonly enabled: boolean;
                    readonly limit: {
                        readonly context: number;
                        readonly input?: number | undefined;
                        readonly output: number;
                    };
                }[];
                readonly connected: readonly (string & import("effect/Brand").Brand<"ProviderV2.ID">)[];
                readonly default: {
                    readonly [x: string & import("effect/Brand").Brand<"ProviderV2.ID">]: string & import("effect/Brand").Brand<"ModelV2.ID">;
                };
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: (input?: Endpoint7_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly integrationID?: (string & import("effect/Brand").Brand<"Integration.ID">) | undefined;
                readonly name: string;
                readonly disabled?: boolean | undefined;
                readonly api: {
                    readonly type: "aisdk";
                    readonly package: string;
                    readonly url?: string | undefined;
                    readonly settings?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                } | {
                    readonly type: "native";
                    readonly url?: string | undefined;
                    readonly settings: {
                        readonly [x: string]: unknown;
                    };
                };
                readonly request: {
                    readonly headers: {
                        readonly [x: string]: string;
                    };
                    readonly body: {
                        readonly [x: string]: Schema.Json;
                    };
                };
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        get: (input: Endpoint7_2Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly integrationID?: (string & import("effect/Brand").Brand<"Integration.ID">) | undefined;
                readonly name: string;
                readonly disabled?: boolean | undefined;
                readonly api: {
                    readonly type: "aisdk";
                    readonly package: string;
                    readonly url?: string | undefined;
                    readonly settings?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                } | {
                    readonly type: "native";
                    readonly url?: string | undefined;
                    readonly settings: {
                        readonly [x: string]: unknown;
                    };
                };
                readonly request: {
                    readonly headers: {
                        readonly [x: string]: string;
                    };
                    readonly body: {
                        readonly [x: string]: Schema.Json;
                    };
                };
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").ProviderNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        discoverModels: (input: Endpoint7_3Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                readonly source: "compatible" | "oauth" | "provider";
                readonly models: readonly {
                    readonly id: string;
                    readonly name?: string | undefined;
                    readonly context?: number | undefined;
                    readonly input?: number | undefined;
                    readonly output?: number | undefined;
                }[];
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").ProviderModelDiscoveryError | import("@opencode-ai/protocol/errors").ProviderNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        disconnect: (input: Endpoint7_4Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: boolean;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        discoverCustom: (input: Endpoint7_5Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly endpoint: string;
                readonly models: readonly {
                    readonly id: string;
                    readonly name?: string | undefined;
                    readonly reasoning?: boolean | undefined;
                    readonly context?: number | undefined;
                    readonly output?: number | undefined;
                }[];
            };
        }, ClientError | import("@opencode-ai/schema/custom-provider").DiscoveryError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/schema/custom-provider").ValidationError, never>;
        configureCustom: (input: Endpoint7_6Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly providerID: string;
                readonly name: string;
                readonly protocol: "anthropic-messages" | "openai-compatible" | "openai-responses";
                readonly models: readonly string[];
            };
        }, ClientError | import("@opencode-ai/schema/custom-provider").ConfigureError | import("@opencode-ai/schema/custom-provider").ConflictError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/schema/custom-provider").ValidationError, never>;
        disconnectCustom: (input: Endpoint7_7Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: boolean;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    integrations: {
        list: (input?: Endpoint8_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly import("@opencode-ai/schema/integration").Info[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        get: (input: Endpoint8_1Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: import("@opencode-ai/schema/integration").Info | undefined;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        connectKey: (input: Endpoint8_2Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        connectOauth: (input: Endpoint8_3Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: import("@opencode-ai/schema/integration").Attempt;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        attemptStatus: (input: Endpoint8_4Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly status: "pending";
                readonly time: {
                    readonly created: number;
                    readonly expires: number;
                };
            } | {
                readonly status: "complete";
                readonly time: {
                    readonly created: number;
                    readonly expires: number;
                };
            } | {
                readonly status: "failed";
                readonly message: string;
                readonly time: {
                    readonly created: number;
                    readonly expires: number;
                };
            } | {
                readonly status: "expired";
                readonly time: {
                    readonly created: number;
                    readonly expires: number;
                };
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        attemptComplete: (input: Endpoint8_5Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        attemptCancel: (input: Endpoint8_6Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    credentials: {
        update: (input: Endpoint9_0Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        remove: (input: Endpoint9_1Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    permissions: {
        listRequests: (input?: Endpoint10_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly action: string;
                readonly resources: readonly string[];
                readonly save?: readonly string[] | undefined;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly source?: {
                    readonly type: "tool";
                    readonly messageID: string;
                    readonly callID: string;
                } | undefined;
                readonly id: string & import("effect/Brand").Brand<"PermissionV2.ID">;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        listSaved: (input?: Endpoint10_1Input | undefined) => Effect.Effect<readonly {
            readonly id: string & import("effect/Brand").Brand<"PermissionSaved.ID">;
            readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            readonly action: string;
            readonly resource: string;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        removeSaved: (input: Endpoint10_2Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        create: (input: Endpoint10_3Input) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"PermissionV2.ID">;
            readonly effect: "allow" | "ask" | "deny";
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: (input: Endpoint10_4Input) => Effect.Effect<readonly {
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly action: string;
            readonly resources: readonly string[];
            readonly save?: readonly string[] | undefined;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly source?: {
                readonly type: "tool";
                readonly messageID: string;
                readonly callID: string;
            } | undefined;
            readonly id: string & import("effect/Brand").Brand<"PermissionV2.ID">;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        get: (input: Endpoint10_5Input) => Effect.Effect<{
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly action: string;
            readonly resources: readonly string[];
            readonly save?: readonly string[] | undefined;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly source?: {
                readonly type: "tool";
                readonly messageID: string;
                readonly callID: string;
            } | undefined;
            readonly id: string & import("effect/Brand").Brand<"PermissionV2.ID">;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").PermissionNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        reply: (input: Endpoint10_6Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").PermissionNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    files: {
        read: (input: Endpoint11_0Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly uri: string;
                readonly name?: string | undefined;
                readonly content: string;
                readonly encoding: "base64" | "utf8";
                readonly mime: string;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: (input?: Endpoint11_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                readonly type: "directory" | "file";
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        find: (input: Endpoint11_2Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                readonly type: "directory" | "file";
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    commands: {
        list: (input?: Endpoint12_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly name: string;
                readonly template: string;
                readonly description?: string | undefined;
                readonly agent?: string | undefined;
                readonly model?: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                } | undefined;
                readonly subtask?: boolean | undefined;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    skills: {
        list: (input?: Endpoint13_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly name: string;
                readonly description?: string | undefined;
                readonly slash?: boolean | undefined;
                readonly location: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly content: string;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    mcps: {
        status: (input?: Endpoint14_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly [x: string]: {
                    readonly status: "connected";
                } | {
                    readonly status: "disabled";
                } | {
                    readonly status: "failed";
                    readonly error: string;
                } | {
                    readonly status: "needs_auth";
                } | {
                    readonly status: "needs_client_registration";
                    readonly error: string;
                };
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        resources: (input?: Endpoint14_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly [x: string]: {
                    readonly name: string;
                    readonly uri: string;
                    readonly description?: string | undefined;
                    readonly mimeType?: string | undefined;
                    readonly client: string;
                };
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        connect: (input: Endpoint14_2Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").McpNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        disconnect: (input: Endpoint14_3Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").McpNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        authenticate: (input: Endpoint14_4Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly status: "connected";
            } | {
                readonly status: "disabled";
            } | {
                readonly status: "failed";
                readonly error: string;
            } | {
                readonly status: "needs_auth";
            } | {
                readonly status: "needs_client_registration";
                readonly error: string;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").McpNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    lsp: {
        status: (input?: Endpoint15_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string;
                readonly name: string;
                readonly root: string;
                readonly status: "connected" | "error";
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    projects: {
        list: () => Effect.Effect<readonly {
            readonly id: string & import("effect/Brand").Brand<"Project.ID">;
            readonly worktree: string;
            readonly vcs?: "git" | undefined;
            readonly name?: string | undefined;
            readonly icon?: {
                readonly url?: string | undefined;
                readonly override?: string | undefined;
                readonly color?: string | undefined;
            } | undefined;
            readonly commands?: {
                readonly start?: string | undefined;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly updated: number;
                readonly initialized?: number | undefined;
            };
            readonly sandboxes: readonly string[];
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        initGit: (input?: Endpoint16_1Input | undefined) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"Project.ID">;
            readonly worktree: string;
            readonly vcs?: "git" | undefined;
            readonly name?: string | undefined;
            readonly icon?: {
                readonly url?: string | undefined;
                readonly override?: string | undefined;
                readonly color?: string | undefined;
            } | undefined;
            readonly commands?: {
                readonly start?: string | undefined;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly updated: number;
                readonly initialized?: number | undefined;
            };
            readonly sandboxes: readonly string[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/groups/project").ProjectOperationError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        current: (input?: Endpoint16_2Input | undefined) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"Project.ID">;
            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        update: (input: Endpoint16_3Input) => Effect.Effect<{
            readonly id: string & import("effect/Brand").Brand<"Project.ID">;
            readonly worktree: string;
            readonly vcs?: "git" | undefined;
            readonly name?: string | undefined;
            readonly icon?: {
                readonly url?: string | undefined;
                readonly override?: string | undefined;
                readonly color?: string | undefined;
            } | undefined;
            readonly commands?: {
                readonly start?: string | undefined;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly updated: number;
                readonly initialized?: number | undefined;
            };
            readonly sandboxes: readonly string[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").ProjectNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        directories: (input: Endpoint16_4Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly strategy?: string | undefined;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    worktrees: {
        create: (input?: Endpoint17_0Input | undefined) => Effect.Effect<{
            readonly name: string;
            readonly branch?: string | undefined;
            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/groups/worktree").WorktreeOperationError, never>;
        remove: (input: Endpoint17_1Input) => Effect.Effect<boolean, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/groups/worktree").WorktreeOperationError, never>;
        reset: (input: Endpoint17_2Input) => Effect.Effect<boolean, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError | import("@opencode-ai/protocol/groups/worktree").WorktreeOperationError, never>;
    };
    capabilities: {
        get: () => Effect.Effect<{
            readonly backgroundSubagents: boolean;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    vcs: {
        get: (input?: Endpoint19_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly branch?: string | undefined;
                readonly default_branch?: string | undefined;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        status: (input?: Endpoint19_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly file: string;
                readonly additions: number;
                readonly deletions: number;
                readonly status: "added" | "deleted" | "modified";
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        diff: (input: Endpoint19_2Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly file?: string | undefined;
                readonly patch?: string | undefined;
                readonly additions: number;
                readonly deletions: number;
                readonly status?: "added" | "deleted" | "modified" | undefined;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    formatters: {
        status: (input?: Endpoint20_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly name: string;
                readonly extensions: readonly string[];
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    console: {
        get: (input?: Endpoint21_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly consoleManagedProviders: readonly string[];
                readonly activeOrgName?: string | undefined;
                readonly switchableOrgCount: number;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        listOrgs: (input?: Endpoint21_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly accountID: string;
                readonly accountEmail: string;
                readonly accountUrl: string;
                readonly orgID: string;
                readonly orgName: string;
                readonly active: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        switchOrg: (input: Endpoint21_2Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: boolean;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    config: {
        get: (input?: Endpoint22_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: Schema.Json;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        update: (input: Endpoint22_1Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: Schema.Json;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    workspaces: {
        listAdapters: (input?: Endpoint23_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly type: string;
                readonly name: string;
                readonly description: string;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: (input?: Endpoint23_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"WorkspaceV2.ID">;
                readonly type: string;
                readonly name: string;
                readonly branch?: string | null | undefined;
                readonly directory?: string | null | undefined;
                readonly extra?: unknown;
                readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                readonly timeUsed: number;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        create: (input: Endpoint23_2Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"WorkspaceV2.ID">;
                readonly type: string;
                readonly name: string;
                readonly branch?: string | null | undefined;
                readonly directory?: string | null | undefined;
                readonly extra?: unknown;
                readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                readonly timeUsed: number;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        remove: (input: Endpoint23_3Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: boolean;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        status: (input?: Endpoint23_4Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly workspaceID: string & import("effect/Brand").Brand<"WorkspaceV2.ID">;
                readonly status: "connected" | "connecting" | "disconnected" | "error";
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        syncList: (input?: Endpoint23_5Input | undefined) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        start: (input?: Endpoint23_6Input | undefined) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        warp: (input: Endpoint23_7Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    controlPlane: {
        moveSession: (input: Endpoint24_0Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    "server.plugins": {
        runtime: (input?: Endpoint25_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly plugins: readonly {
                    readonly id: string & import("effect/Brand").Brand<"Plugin.ID">;
                    readonly state: "degraded" | "disabled" | "failed" | "initializing" | "ready";
                    readonly capabilities: readonly {
                        readonly name: "commands" | "mcp" | "plugin" | "skills" | "tools";
                        readonly state: "disabled" | "failed" | "pending" | "ready";
                        readonly message?: string | undefined;
                    }[];
                }[];
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: () => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        add: (input: Endpoint25_2Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        refresh: (input: Endpoint25_3Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        remove: (input: Endpoint25_4Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        install: (input: Endpoint25_5Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        uninstall: (input: Endpoint25_6Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        enable: (input: Endpoint25_7Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        disable: (input: Endpoint25_8Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        inspectDirect: (input: Endpoint25_9Input) => Effect.Effect<{
            readonly source: string;
            readonly name: string;
            readonly description?: string | undefined;
            readonly version?: string | undefined;
            readonly api?: string | undefined;
            readonly targets: readonly ("server" | "tui")[];
            readonly requestedCapabilities: readonly {
                readonly name: string;
                readonly tier: "declarative" | "runtime" | "trusted-runtime";
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        installDirect: (input: Endpoint25_10Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        uninstallDirect: (input: Endpoint25_11Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        enableDirect: (input: Endpoint25_12Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        disableDirect: (input: Endpoint25_13Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        installMcp: (input: Endpoint25_14Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        removeMcp: (input: Endpoint25_15Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        enableMcp: (input: Endpoint25_16Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        disableMcp: (input: Endpoint25_17Input) => Effect.Effect<{
            readonly marketplaces: readonly {
                readonly name: string;
                readonly source: string;
                readonly lastUpdated: string;
                readonly pluginCount: number;
                readonly error?: string | undefined;
            }[];
            readonly plugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly marketplace: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly category?: string | undefined;
                readonly tags: readonly string[];
                readonly capabilities: readonly string[];
                readonly mcpServers: readonly string[];
                readonly installed: boolean;
                readonly enabled: boolean;
            }[];
            readonly directPlugins: readonly {
                readonly id: string;
                readonly name: string;
                readonly source: string;
                readonly description?: string | undefined;
                readonly version?: string | undefined;
                readonly api?: string | undefined;
                readonly targets: readonly ("server" | "tui")[];
                readonly requestedCapabilities: readonly {
                    readonly name: string;
                    readonly tier: "declarative" | "runtime" | "trusted-runtime";
                }[];
                readonly approvedCapabilities: readonly string[];
                readonly enabled: boolean;
                readonly installedAt: string;
            }[];
            readonly mcpServers: readonly {
                readonly name: string;
                readonly type: "local" | "remote";
                readonly enabled: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").ServiceUnavailableError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    events: {
        subscribe: () => Stream.Stream<{
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "project.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"Project.ID">;
                readonly worktree: string;
                readonly vcs?: "git" | undefined;
                readonly name?: string | undefined;
                readonly icon?: {
                    readonly url?: string | undefined;
                    readonly override?: string | undefined;
                    readonly color?: string | undefined;
                } | undefined;
                readonly commands?: {
                    readonly start?: string | undefined;
                } | undefined;
                readonly time: {
                    readonly created: number;
                    readonly updated: number;
                    readonly initialized?: number | undefined;
                };
                readonly sandboxes: readonly string[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.created";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly slug: string;
                    readonly version: string;
                    readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly updated: import("effect/DateTime").Utc;
                        readonly compacting?: import("effect/DateTime").Utc | undefined;
                        readonly archived?: import("effect/DateTime").Utc | undefined;
                    };
                    readonly title: string;
                    readonly metadata?: {
                        readonly [x: string]: Schema.Json;
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly permission?: readonly {
                        readonly action: string;
                        readonly resource: string;
                        readonly effect: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly slug: string;
                    readonly version: string;
                    readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly updated: import("effect/DateTime").Utc;
                        readonly compacting?: import("effect/DateTime").Utc | undefined;
                        readonly archived?: import("effect/DateTime").Utc | undefined;
                    };
                    readonly title: string;
                    readonly metadata?: {
                        readonly [x: string]: Schema.Json;
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly permission?: readonly {
                        readonly action: string;
                        readonly resource: string;
                        readonly effect: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.deleted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly slug: string;
                    readonly version: string;
                    readonly agent?: (string & import("effect/Brand").Brand<"AgentV2.ID">) | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly updated: import("effect/DateTime").Utc;
                        readonly compacting?: import("effect/DateTime").Utc | undefined;
                        readonly archived?: import("effect/DateTime").Utc | undefined;
                    };
                    readonly title: string;
                    readonly metadata?: {
                        readonly [x: string]: Schema.Json;
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly permission?: readonly {
                        readonly action: string;
                        readonly resource: string;
                        readonly effect: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly location: {
                        readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                        readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    };
                    readonly subpath?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                        readonly partID?: string | undefined;
                        readonly contentIndex?: number | undefined;
                        readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                        readonly files?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.status";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly status: {
                    readonly type: "idle";
                } | {
                    readonly type: "retry";
                    readonly attempt: number;
                    readonly message: string;
                    readonly action?: {
                        readonly reason: string;
                        readonly provider: string;
                        readonly title: string;
                        readonly message: string;
                        readonly label: string;
                        readonly link?: string | undefined;
                    } | undefined;
                    readonly next: number;
                } | {
                    readonly type: "busy";
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.diff";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly diff: readonly {
                    readonly file?: string | undefined;
                    readonly patch?: string | undefined;
                    readonly additions: number;
                    readonly deletions: number;
                    readonly status?: "added" | "deleted" | "modified" | undefined;
                }[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.error";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                readonly error: {
                    readonly name: string;
                    readonly data: unknown;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.agent.switched";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly agent: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.model.switched";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly model: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.moved";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly location: {
                    readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                };
                readonly subdirectory?: (string & import("effect/Brand").Brand<"RelativePath">) | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.message.imported";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly message: {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "agent-switched";
                    readonly agent: string;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "model-switched";
                    readonly model: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly text: string;
                    readonly context?: readonly {
                        readonly text: string;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    }[] | undefined;
                    readonly files?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly agents?: readonly {
                        readonly name: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly guidance?: string | undefined;
                    }[] | undefined;
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: unknown;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
                    readonly type: "user";
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly text: string;
                    readonly description?: string | undefined;
                    readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
                    readonly type: "synthetic";
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "system";
                    readonly text: string;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly type: "shell";
                    readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                    readonly callID: string;
                    readonly command: string;
                    readonly output: string;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly type: "assistant";
                    readonly agent: string;
                    readonly model: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                    readonly content: readonly ({
                        readonly type: "text";
                        readonly id: string;
                        readonly text: string;
                    } | {
                        readonly type: "reasoning";
                        readonly id: string;
                        readonly text: string;
                        readonly providerMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                        readonly time?: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                        } | undefined;
                    } | {
                        readonly type: "tool";
                        readonly id: string;
                        readonly name: string;
                        readonly provider?: {
                            readonly executed: boolean;
                            readonly metadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                            readonly resultMetadata?: {
                                readonly [x: string]: {
                                    readonly [x: string]: unknown;
                                };
                            } | undefined;
                        } | undefined;
                        readonly state: {
                            readonly status: "pending";
                            readonly input: string;
                        } | {
                            readonly status: "running";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                        } | {
                            readonly status: "completed";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly attachments?: readonly {
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly source?: {
                                    readonly start: number;
                                    readonly end: number;
                                    readonly text: string;
                                } | undefined;
                                readonly resource?: {
                                    readonly clientName: string;
                                    readonly uri: string;
                                } | undefined;
                                readonly materialized?: readonly ({
                                    readonly type: "text";
                                    readonly text: string;
                                } | {
                                    readonly type: "file";
                                    readonly uri: string;
                                    readonly mime: string;
                                    readonly name?: string | undefined;
                                } | {
                                    readonly type: "error";
                                    readonly message: string;
                                })[] | undefined;
                            }[] | undefined;
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                            readonly outputPaths?: readonly string[] | undefined;
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly result?: unknown;
                        } | {
                            readonly status: "error";
                            readonly input: {
                                readonly [x: string]: unknown;
                            };
                            readonly content: readonly ({
                                readonly type: "text";
                                readonly text: string;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                                readonly provenance?: {
                                    readonly type: "mcp";
                                    readonly clientName: string;
                                    readonly uri: string;
                                    readonly kind: "resource" | "resource_link";
                                    readonly mime?: string | undefined;
                                    readonly name?: string | undefined;
                                    readonly description?: string | undefined;
                                    readonly size?: number | undefined;
                                    readonly annotations?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                    readonly meta?: {
                                        readonly [x: string]: unknown;
                                    } | undefined;
                                } | undefined;
                            })[];
                            readonly structured: {
                                readonly [x: string]: unknown;
                            };
                            readonly error: {
                                readonly type: "unknown";
                                readonly message: string;
                            };
                            readonly result?: unknown;
                        };
                        readonly time: {
                            readonly created: import("effect/DateTime").Utc;
                            readonly ran?: import("effect/DateTime").Utc | undefined;
                            readonly completed?: import("effect/DateTime").Utc | undefined;
                            readonly pruned?: import("effect/DateTime").Utc | undefined;
                        };
                    })[];
                    readonly snapshot?: {
                        readonly start?: string | undefined;
                        readonly end?: string | undefined;
                        readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                        readonly patch?: readonly {
                            readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                            readonly status: "added" | "deleted" | "modified";
                            readonly additions: number;
                            readonly deletions: number;
                            readonly patch: string;
                        }[] | undefined;
                    } | undefined;
                    readonly finish?: string | undefined;
                    readonly structured?: unknown;
                    readonly cost?: number | undefined;
                    readonly tokens?: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    } | undefined;
                    readonly error?: {
                        readonly type: "unknown";
                        readonly message: string;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                    };
                    readonly type: "compaction";
                    readonly reason: "auto" | "manual";
                    readonly summary: string;
                    readonly recent: string;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.message.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.user-text.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID: string;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.user-text.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.content.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly contentIndex: number;
                readonly partID: string;
                readonly content: {
                    readonly type: "text";
                    readonly id: string;
                    readonly text: string;
                } | {
                    readonly type: "reasoning";
                    readonly id: string;
                    readonly text: string;
                    readonly providerMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                    readonly time?: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                    } | undefined;
                } | {
                    readonly type: "tool";
                    readonly id: string;
                    readonly name: string;
                    readonly provider?: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                        readonly resultMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: unknown;
                            };
                        } | undefined;
                    } | undefined;
                    readonly state: {
                        readonly status: "pending";
                        readonly input: string;
                    } | {
                        readonly status: "running";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                    } | {
                        readonly status: "completed";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly attachments?: readonly {
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly description?: string | undefined;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            } | undefined;
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                            readonly materialized?: readonly ({
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string | undefined;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            })[] | undefined;
                        }[] | undefined;
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                        readonly outputPaths?: readonly string[] | undefined;
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly result?: unknown;
                    } | {
                        readonly status: "error";
                        readonly input: {
                            readonly [x: string]: unknown;
                        };
                        readonly content: readonly ({
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string | undefined;
                                readonly name?: string | undefined;
                                readonly description?: string | undefined;
                                readonly size?: number | undefined;
                                readonly annotations?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                                readonly meta?: {
                                    readonly [x: string]: unknown;
                                } | undefined;
                            } | undefined;
                        })[];
                        readonly structured: {
                            readonly [x: string]: unknown;
                        };
                        readonly error: {
                            readonly type: "unknown";
                            readonly message: string;
                        };
                        readonly result?: unknown;
                    };
                    readonly time: {
                        readonly created: import("effect/DateTime").Utc;
                        readonly ran?: import("effect/DateTime").Utc | undefined;
                        readonly completed?: import("effect/DateTime").Utc | undefined;
                        readonly pruned?: import("effect/DateTime").Utc | undefined;
                    };
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.transcript.content.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly contentIndex: number;
                readonly partID: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.prompted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly prompt: {
                    readonly text: string;
                    readonly context?: readonly {
                        readonly text: string;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    }[] | undefined;
                    readonly files?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly agents?: readonly {
                        readonly name: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly guidance?: string | undefined;
                    }[] | undefined;
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: unknown;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
                };
                readonly synthetic?: {
                    readonly description: string;
                    readonly scope?: "session" | "turn" | undefined;
                } | undefined;
                readonly delivery: "queue" | "steer";
                readonly intent?: {
                    readonly type: "start";
                } | {
                    readonly type: "steer";
                    readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                } | {
                    readonly type: "queue";
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.prompt.admitted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly prompt: {
                    readonly text: string;
                    readonly context?: readonly {
                        readonly text: string;
                        readonly metadata?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    }[] | undefined;
                    readonly files?: readonly {
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        } | undefined;
                        readonly materialized?: readonly ({
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string | undefined;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        })[] | undefined;
                    }[] | undefined;
                    readonly agents?: readonly {
                        readonly name: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        } | undefined;
                        readonly guidance?: string | undefined;
                    }[] | undefined;
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: unknown;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
                };
                readonly synthetic?: {
                    readonly description: string;
                    readonly scope?: "session" | "turn" | undefined;
                } | undefined;
                readonly delivery: "queue" | "steer";
                readonly intent?: {
                    readonly type: "start";
                } | {
                    readonly type: "steer";
                    readonly expectedTurnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                } | {
                    readonly type: "queue";
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.turn.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly turnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.turn.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly turnID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly outcome?: "abandoned" | "completed" | "failed" | "interrupted" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.context.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.synthetic";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly text: string;
                readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.shell.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly userID?: (string & import("effect/Brand").Brand<"Session.Message.ID">) | undefined;
                readonly callID: string;
                readonly command: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.shell.delta";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly callID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.shell.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly callID: string;
                readonly output: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.step.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly agent: string;
                readonly model: {
                    readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly variant?: (string & import("effect/Brand").Brand<"VariantID">) | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
                readonly snapshot?: string | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.step.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly finish: string;
                readonly cost: number;
                readonly tokens: {
                    readonly input: number;
                    readonly output: number;
                    readonly reasoning: number;
                    readonly cache: {
                        readonly read: number;
                        readonly write: number;
                    };
                };
                readonly snapshot?: string | undefined;
                readonly files?: readonly (string & import("effect/Brand").Brand<"RelativePath">)[] | undefined;
                readonly patch?: readonly {
                    readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.step.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.text.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly textID: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.text.delta";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly textID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.text.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly textID: string;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.reasoning.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reasoningID: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.reasoning.delta";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reasoningID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.reasoning.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reasoningID: string;
                readonly text: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.input.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly name: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.input.delta";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.input.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.called";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly tool: string;
                readonly input: {
                    readonly [x: string]: unknown;
                };
                readonly provider: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.progress";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly structured: {
                    readonly [x: string]: unknown;
                };
                readonly content: readonly ({
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                })[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.success";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly structured: {
                    readonly [x: string]: unknown;
                };
                readonly content: readonly ({
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string | undefined;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string | undefined;
                        readonly name?: string | undefined;
                        readonly description?: string | undefined;
                        readonly size?: number | undefined;
                        readonly annotations?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                        readonly meta?: {
                            readonly [x: string]: unknown;
                        } | undefined;
                    } | undefined;
                })[];
                readonly outputPaths?: readonly string[] | undefined;
                readonly result?: unknown;
                readonly provider: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
                readonly result?: unknown;
                readonly provider: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.tool-discovery.completed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly callID: string;
                readonly query: string;
                readonly limit: number;
                readonly catalogRevision: string;
                readonly matches: readonly {
                    readonly key: string & import("effect/Brand").Brand<"ToolCatalog.Key">;
                    readonly callableName: string;
                    readonly definitionHash: string;
                    readonly source: {
                        readonly type: "app" | "builtin" | "mcp" | "plugin";
                        readonly id: string;
                        readonly displayName?: string | undefined;
                    };
                }[];
                readonly pendingSources: readonly {
                    readonly type: "app" | "builtin" | "mcp" | "plugin";
                    readonly id: string;
                    readonly displayName?: string | undefined;
                }[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.attempt.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly attempt: number;
                readonly retryOf?: (string & import("effect/Brand").Brand<"Event.ID">) | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.attempt.response.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.attempt.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly assistantMessageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly outcome: "abandoned" | "completed" | "failed" | "interrupted";
                readonly continuation: boolean;
                readonly error?: {
                    readonly type: "unknown";
                    readonly message: string;
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.provider.recovery.decided";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly decision: "abandon" | "retry";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.retried";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly attemptID: string & import("effect/Brand").Brand<"Event.ID">;
                readonly attempt: number;
                readonly next: import("effect/DateTime").Utc;
                readonly error: {
                    readonly message: string;
                    readonly statusCode?: number | undefined;
                    readonly isRetryable: boolean;
                    readonly responseHeaders?: {
                        readonly [x: string]: string;
                    } | undefined;
                    readonly responseBody?: string | undefined;
                    readonly metadata?: {
                        readonly [x: string]: string;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.started";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reason: "auto" | "manual";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.delta";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.ended";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reason: "auto" | "manual";
                readonly text: string;
                readonly recent: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.compaction.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly reason: "auto" | "manual";
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.revert.cleared";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.revert.committed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                readonly partID?: string | undefined;
                readonly contentIndex?: number | undefined;
                readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.next.revert.staged";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: import("effect/DateTime").Utc;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly revert: {
                    readonly messageID: string & import("effect/Brand").Brand<"Session.Message.ID">;
                    readonly partID?: string | undefined;
                    readonly contentIndex?: number | undefined;
                    readonly removedMessageIDs?: readonly (string & import("effect/Brand").Brand<"Session.Message.ID">)[] | undefined;
                    readonly snapshot?: string | undefined;
                    readonly diff?: string | undefined;
                    readonly files?: readonly {
                        readonly path: string & import("effect/Brand").Brand<"RelativePath">;
                        readonly status: "added" | "deleted" | "modified";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }[] | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "lsp.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "project.directories.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "global.disposed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly reason?: "agent-config" | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "server.connected";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "worktree.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly message: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "worktree.ready";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly name: string;
                readonly branch?: string | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "models-dev.refreshed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "integration.connection.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly integrationID: string & import("effect/Brand").Brand<"Integration.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "integration.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "catalog.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "vcs.branch.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly branch?: string | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "message.part.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                readonly partID: string & import("effect/Brand").Brand<"PartID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "message.part.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly part: {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "text";
                    readonly text: string;
                    readonly synthetic?: boolean | undefined;
                    readonly ignored?: boolean | undefined;
                    readonly time?: {
                        readonly start: number;
                        readonly end?: number | undefined;
                    } | undefined;
                    readonly metadata?: {
                        readonly [x: string]: any;
                    } | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "subtask";
                    readonly prompt: string;
                    readonly description: string;
                    readonly agent: string;
                    readonly model?: {
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly modelID: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    } | undefined;
                    readonly command?: string | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "reasoning";
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: any;
                    } | undefined;
                    readonly time: {
                        readonly start: number;
                        readonly end?: number | undefined;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "file";
                    readonly mime: string;
                    readonly filename?: string | undefined;
                    readonly url: string;
                    readonly source?: {
                        readonly text: {
                            readonly value: string;
                            readonly start: number;
                            readonly end: number;
                        };
                        readonly type: "file";
                        readonly path: string;
                    } | {
                        readonly text: {
                            readonly value: string;
                            readonly start: number;
                            readonly end: number;
                        };
                        readonly type: "symbol";
                        readonly path: string;
                        readonly range: {
                            readonly start: {
                                readonly line: number;
                                readonly character: number;
                            };
                            readonly end: {
                                readonly line: number;
                                readonly character: number;
                            };
                        };
                        readonly name: string;
                        readonly kind: number;
                    } | {
                        readonly text: {
                            readonly value: string;
                            readonly start: number;
                            readonly end: number;
                        };
                        readonly type: "resource";
                        readonly clientName: string;
                        readonly uri: string;
                    } | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "tool";
                    readonly callID: string;
                    readonly tool: string;
                    readonly state: {
                        readonly status: "pending";
                        readonly input: {
                            readonly [x: string]: any;
                        };
                        readonly raw: string;
                    } | {
                        readonly status: "running";
                        readonly input: {
                            readonly [x: string]: any;
                        };
                        readonly title?: string | undefined;
                        readonly metadata?: {
                            readonly [x: string]: any;
                        } | undefined;
                        readonly time: {
                            readonly start: number;
                        };
                    } | {
                        readonly status: "completed";
                        readonly input: {
                            readonly [x: string]: any;
                        };
                        readonly output: string;
                        readonly title: string;
                        readonly metadata: {
                            readonly [x: string]: any;
                        };
                        readonly time: {
                            readonly start: number;
                            readonly end: number;
                            readonly compacted?: number | undefined;
                        };
                        readonly attachments?: readonly {
                            readonly id: string & import("effect/Brand").Brand<"PartID">;
                            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                            readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                            readonly type: "file";
                            readonly mime: string;
                            readonly filename?: string | undefined;
                            readonly url: string;
                            readonly source?: {
                                readonly text: {
                                    readonly value: string;
                                    readonly start: number;
                                    readonly end: number;
                                };
                                readonly type: "file";
                                readonly path: string;
                            } | {
                                readonly text: {
                                    readonly value: string;
                                    readonly start: number;
                                    readonly end: number;
                                };
                                readonly type: "symbol";
                                readonly path: string;
                                readonly range: {
                                    readonly start: {
                                        readonly line: number;
                                        readonly character: number;
                                    };
                                    readonly end: {
                                        readonly line: number;
                                        readonly character: number;
                                    };
                                };
                                readonly name: string;
                                readonly kind: number;
                            } | {
                                readonly text: {
                                    readonly value: string;
                                    readonly start: number;
                                    readonly end: number;
                                };
                                readonly type: "resource";
                                readonly clientName: string;
                                readonly uri: string;
                            } | undefined;
                        }[] | undefined;
                    } | {
                        readonly status: "error";
                        readonly input: {
                            readonly [x: string]: any;
                        };
                        readonly error: string;
                        readonly metadata?: {
                            readonly [x: string]: any;
                        } | undefined;
                        readonly time: {
                            readonly start: number;
                            readonly end: number;
                        };
                    };
                    readonly metadata?: {
                        readonly [x: string]: any;
                    } | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "step-start";
                    readonly snapshot?: string | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "step-finish";
                    readonly reason: string;
                    readonly snapshot?: string | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly total?: number | undefined;
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "snapshot";
                    readonly snapshot: string;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "patch";
                    readonly hash: string;
                    readonly files: readonly string[];
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "agent";
                    readonly name: string;
                    readonly source?: {
                        readonly value: string;
                        readonly start: number;
                        readonly end: number;
                    } | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "retry";
                    readonly attempt: number;
                    readonly error: {
                        readonly name: "APIError";
                        readonly data: {
                            readonly message: string;
                            readonly statusCode?: number | undefined;
                            readonly isRetryable: boolean;
                            readonly responseHeaders?: {
                                readonly [x: string]: string;
                            } | undefined;
                            readonly responseBody?: string | undefined;
                            readonly metadata?: {
                                readonly [x: string]: string;
                            } | undefined;
                        };
                    };
                    readonly time: {
                        readonly created: number;
                    };
                } | {
                    readonly id: string & import("effect/Brand").Brand<"PartID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly type: "compaction";
                    readonly auto: boolean;
                    readonly overflow?: boolean | undefined;
                    readonly tail_start_id?: (string & import("effect/Brand").Brand<"MessageID">) | undefined;
                };
                readonly time: number;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "message.removed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "message.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"MessageID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly role: "user";
                    readonly time: {
                        readonly created: number;
                    };
                    readonly format?: import("@opencode-ai/schema/session-v1").OutputFormatJsonSchema | import("@opencode-ai/schema/session-v1").OutputFormatText | undefined;
                    readonly summary?: {
                        readonly title?: string | undefined;
                        readonly body?: string | undefined;
                        readonly diffs: readonly {
                            readonly file?: string | undefined;
                            readonly patch?: string | undefined;
                            readonly additions: number;
                            readonly deletions: number;
                            readonly status?: "added" | "deleted" | "modified" | undefined;
                        }[];
                    } | undefined;
                    readonly agent: string;
                    readonly model: {
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly modelID: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                } | {
                    readonly id: string & import("effect/Brand").Brand<"MessageID">;
                    readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                    readonly role: "assistant";
                    readonly time: {
                        readonly created: number;
                        readonly completed?: number | undefined;
                    };
                    readonly error?: {
                        readonly name: "ProviderAuthError";
                        readonly data: {
                            readonly providerID: string;
                            readonly message: string;
                        };
                    } | {
                        readonly name: "UnknownError";
                        readonly data: {
                            readonly message: string;
                            readonly ref?: string | undefined;
                        };
                    } | {
                        readonly name: "MessageOutputLengthError";
                        readonly data: {};
                    } | {
                        readonly name: "MessageAbortedError";
                        readonly data: {
                            readonly message: string;
                        };
                    } | {
                        readonly name: "StructuredOutputError";
                        readonly data: {
                            readonly message: string;
                            readonly retries: number;
                        };
                    } | {
                        readonly name: "ContextOverflowError";
                        readonly data: {
                            readonly message: string;
                            readonly responseBody?: string | undefined;
                        };
                    } | {
                        readonly name: "ContentFilterError";
                        readonly data: {
                            readonly message: string;
                        };
                    } | {
                        readonly name: "APIError";
                        readonly data: {
                            readonly message: string;
                            readonly statusCode?: number | undefined;
                            readonly isRetryable: boolean;
                            readonly responseHeaders?: {
                                readonly [x: string]: string;
                            } | undefined;
                            readonly responseBody?: string | undefined;
                            readonly metadata?: {
                                readonly [x: string]: string;
                            } | undefined;
                        };
                    } | undefined;
                    readonly parentID: string & import("effect/Brand").Brand<"MessageID">;
                    readonly modelID: string & import("effect/Brand").Brand<"ModelV2.ID">;
                    readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                    readonly mode: string;
                    readonly agent: string;
                    readonly path: {
                        readonly cwd: string;
                        readonly root: string;
                    };
                    readonly summary?: boolean | undefined;
                    readonly cost: number;
                    readonly tokens: {
                        readonly total?: number | undefined;
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    };
                    readonly structured?: any;
                    readonly variant?: string | undefined;
                    readonly finish?: string | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.created";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly slug: string;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    readonly directory: string;
                    readonly path?: string | undefined;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly summary?: {
                        readonly additions: number;
                        readonly deletions: number;
                        readonly files: number;
                        readonly diffs?: readonly {
                            readonly file?: string | undefined;
                            readonly patch?: string | undefined;
                            readonly additions: number;
                            readonly deletions: number;
                            readonly status?: "added" | "deleted" | "modified" | undefined;
                        }[] | undefined;
                    } | undefined;
                    readonly cost?: number | undefined;
                    readonly tokens?: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly title: string;
                    readonly agent?: string | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly version: string;
                    readonly metadata?: {
                        readonly [x: string]: any;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                        readonly updated: number;
                        readonly compacting?: number | undefined;
                        readonly archived?: number | undefined;
                    };
                    readonly permission?: readonly {
                        readonly permission: string;
                        readonly pattern: string;
                        readonly action: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                        readonly partID?: (string & import("effect/Brand").Brand<"PartID">) | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.deleted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly slug: string;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    readonly directory: string;
                    readonly path?: string | undefined;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly summary?: {
                        readonly additions: number;
                        readonly deletions: number;
                        readonly files: number;
                        readonly diffs?: readonly {
                            readonly file?: string | undefined;
                            readonly patch?: string | undefined;
                            readonly additions: number;
                            readonly deletions: number;
                            readonly status?: "added" | "deleted" | "modified" | undefined;
                        }[] | undefined;
                    } | undefined;
                    readonly cost?: number | undefined;
                    readonly tokens?: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly title: string;
                    readonly agent?: string | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly version: string;
                    readonly metadata?: {
                        readonly [x: string]: any;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                        readonly updated: number;
                        readonly compacting?: number | undefined;
                        readonly archived?: number | undefined;
                    };
                    readonly permission?: readonly {
                        readonly permission: string;
                        readonly pattern: string;
                        readonly action: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                        readonly partID?: (string & import("effect/Brand").Brand<"PartID">) | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"SessionID">;
                    readonly slug: string;
                    readonly projectID: string & import("effect/Brand").Brand<"Project.ID">;
                    readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
                    readonly directory: string;
                    readonly path?: string | undefined;
                    readonly parentID?: (string & import("effect/Brand").Brand<"SessionID">) | undefined;
                    readonly summary?: {
                        readonly additions: number;
                        readonly deletions: number;
                        readonly files: number;
                        readonly diffs?: readonly {
                            readonly file?: string | undefined;
                            readonly patch?: string | undefined;
                            readonly additions: number;
                            readonly deletions: number;
                            readonly status?: "added" | "deleted" | "modified" | undefined;
                        }[] | undefined;
                    } | undefined;
                    readonly cost?: number | undefined;
                    readonly tokens?: {
                        readonly input: number;
                        readonly output: number;
                        readonly reasoning: number;
                        readonly cache: {
                            readonly read: number;
                            readonly write: number;
                        };
                    } | undefined;
                    readonly share?: {
                        readonly url: string;
                    } | undefined;
                    readonly title: string;
                    readonly agent?: string | undefined;
                    readonly model?: {
                        readonly id: string & import("effect/Brand").Brand<"ModelV2.ID">;
                        readonly providerID: string & import("effect/Brand").Brand<"ProviderV2.ID">;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    } | undefined;
                    readonly version: string;
                    readonly metadata?: {
                        readonly [x: string]: any;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                        readonly updated: number;
                        readonly compacting?: number | undefined;
                        readonly archived?: number | undefined;
                    };
                    readonly permission?: readonly {
                        readonly permission: string;
                        readonly pattern: string;
                        readonly action: "allow" | "ask" | "deny";
                    }[] | undefined;
                    readonly revert?: {
                        readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
                        readonly partID?: (string & import("effect/Brand").Brand<"PartID">) | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "file.edited";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly file: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "reference.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "permission.v2.asked";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly action: string;
                readonly resources: readonly string[];
                readonly save?: readonly string[] | undefined;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                } | undefined;
                readonly source?: {
                    readonly type: "tool";
                    readonly messageID: string;
                    readonly callID: string;
                } | undefined;
                readonly id: string & import("effect/Brand").Brand<"PermissionV2.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "permission.v2.replied";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly requestID: string & import("effect/Brand").Brand<"PermissionV2.ID">;
                readonly reply: "always" | "once" | "reject";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "plugin.added";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"Plugin.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "file.watcher.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly file: string;
                readonly event: "add" | "change" | "unlink";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "pty.created";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"PtyID">;
                    readonly title: string;
                    readonly command: string;
                    readonly args: readonly string[];
                    readonly cwd: string;
                    readonly status: "exited" | "running";
                    readonly pid: number;
                    readonly exitCode?: number | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "pty.deleted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"PtyID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "pty.exited";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"PtyID">;
                readonly exitCode: number;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "pty.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly info: {
                    readonly id: string & import("effect/Brand").Brand<"PtyID">;
                    readonly title: string;
                    readonly command: string;
                    readonly args: readonly string[];
                    readonly cwd: string;
                    readonly status: "exited" | "running";
                    readonly pid: number;
                    readonly exitCode?: number | undefined;
                };
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "question.v2.asked";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"QuestionV2.ID">;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly questions: readonly {
                    readonly question: string;
                    readonly header: string;
                    readonly options: readonly {
                        readonly label: string;
                        readonly description: string;
                    }[];
                    readonly multiple?: boolean | undefined;
                    readonly custom?: boolean | undefined;
                }[];
                readonly tool?: {
                    readonly messageID: string;
                    readonly callID: string;
                } | undefined;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "question.v2.rejected";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly requestID: string & import("effect/Brand").Brand<"QuestionV2.ID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "question.v2.replied";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly requestID: string & import("effect/Brand").Brand<"QuestionV2.ID">;
                readonly answers: readonly (readonly string[])[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "todo.updated";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly todos: readonly {
                    readonly content: string;
                    readonly status: string;
                    readonly priority: string;
                }[];
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "tui.command.execute";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly command: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "tui.prompt.append";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly text: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "tui.session.select";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "tui.toast.show";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly title?: string | undefined;
                readonly message: string;
                readonly variant: "error" | "info" | "success" | "warning";
                readonly duration: number;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "mcp.browser.open.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly mcpName: string;
                readonly url: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "mcp.tools.changed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly server: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "command.executed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly name: string;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly arguments: string;
                readonly messageID: string & import("effect/Brand").Brand<"MessageID">;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "workspace.failed";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly message: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "workspace.ready";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly name: string;
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "workspace.status";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly data: {
                readonly workspaceID: string & import("effect/Brand").Brand<"WorkspaceV2.ID">;
                readonly status: "connected" | "connecting" | "disconnected" | "error";
            };
        } | {
            readonly id: string & import("effect/Brand").Brand<"Event.ID">;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
                readonly workspaceID?: (string & import("effect/Brand").Brand<"WorkspaceV2.ID">) | undefined;
            } | undefined;
            readonly type: "server.connected";
            readonly data: {};
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Sse.Retry | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    ptys: {
        shells: (input?: Endpoint27_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly path: string;
                readonly name: string;
                readonly acceptable: boolean;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: (input?: Endpoint27_1Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"PtyID">;
                readonly title: string;
                readonly command: string;
                readonly args: readonly string[];
                readonly cwd: string;
                readonly status: "exited" | "running";
                readonly pid: number;
                readonly exitCode?: number | undefined;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        create: (input?: Endpoint27_2Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"PtyID">;
                readonly title: string;
                readonly command: string;
                readonly args: readonly string[];
                readonly cwd: string;
                readonly status: "exited" | "running";
                readonly pid: number;
                readonly exitCode?: number | undefined;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        get: (input: Endpoint27_3Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"PtyID">;
                readonly title: string;
                readonly command: string;
                readonly args: readonly string[];
                readonly cwd: string;
                readonly status: "exited" | "running";
                readonly pid: number;
                readonly exitCode?: number | undefined;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").PtyNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        update: (input: Endpoint27_4Input) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: {
                readonly id: string & import("effect/Brand").Brand<"PtyID">;
                readonly title: string;
                readonly command: string;
                readonly args: readonly string[];
                readonly cwd: string;
                readonly status: "exited" | "running";
                readonly pid: number;
                readonly exitCode?: number | undefined;
            };
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").PtyNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        remove: (input: Endpoint27_5Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").PtyNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    questions: {
        listRequests: (input?: Endpoint28_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly {
                readonly id: string & import("effect/Brand").Brand<"QuestionV2.ID">;
                readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
                readonly questions: readonly {
                    readonly question: string;
                    readonly header: string;
                    readonly options: readonly {
                        readonly label: string;
                        readonly description: string;
                    }[];
                    readonly multiple?: boolean | undefined;
                    readonly custom?: boolean | undefined;
                }[];
                readonly tool?: {
                    readonly messageID: string;
                    readonly callID: string;
                } | undefined;
            }[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        list: (input: Endpoint28_1Input) => Effect.Effect<readonly {
            readonly id: string & import("effect/Brand").Brand<"QuestionV2.ID">;
            readonly sessionID: string & import("effect/Brand").Brand<"SessionID">;
            readonly questions: readonly {
                readonly question: string;
                readonly header: string;
                readonly options: readonly {
                    readonly label: string;
                    readonly description: string;
                }[];
                readonly multiple?: boolean | undefined;
                readonly custom?: boolean | undefined;
            }[];
            readonly tool?: {
                readonly messageID: string;
                readonly callID: string;
            } | undefined;
        }[], ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        reply: (input: Endpoint28_2Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").QuestionNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        reject: (input: Endpoint28_3Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/errors").QuestionNotFoundError | Schema.SchemaError | import("@opencode-ai/protocol/errors").SessionNotFoundError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    references: {
        list: (input?: Endpoint29_0Input | undefined) => Effect.Effect<{
            readonly location: import("@opencode-ai/schema/location").Info;
            readonly data: readonly import("@opencode-ai/schema/reference").Info[];
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
    projectCopies: {
        generateName: (input: Endpoint30_0Input) => Effect.Effect<{
            readonly name: string;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        create: (input: Endpoint30_1Input) => Effect.Effect<{
            readonly directory: string & import("effect/Brand").Brand<"AbsolutePath">;
        }, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/groups/project-copy").ProjectCopyError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        remove: (input: Endpoint30_2Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/groups/project-copy").ProjectCopyError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
        refresh: (input: Endpoint30_3Input) => Effect.Effect<void, ClientError | HttpClientError.HttpClientError | import("@opencode-ai/protocol/errors").InvalidRequestError | import("@opencode-ai/protocol/groups/project-copy").ProjectCopyError | Schema.SchemaError | import("@opencode-ai/protocol/errors").UnauthorizedError, never>;
    };
}, never, import("effect/unstable/http/HttpClient").HttpClient>;
export {};
