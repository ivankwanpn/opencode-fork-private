import type { HealthGetOutput, LocationGetInput, LocationGetOutput, LocationDisposeInput, PathGetInput, PathGetOutput, AgentsListInput, AgentsListOutput, SessionsListInput, SessionsListOutput, SessionsCreateInput, SessionsGetInput, SessionsChildrenInput, SessionsTodoInput, SessionsForkInput, SessionsUpdateInput, SessionsRemoveInput, SessionsShareInput, SessionsUnshareInput, SessionsSwitchAgentInput, SessionsSwitchModelInput, SessionsPromptInput, SessionsDiffInput, SessionsInputListInput, SessionsInputGetInput, SessionsInputPromoteInput, SessionsInputCancelInput, SessionsBackgroundInput, SessionsCommandInput, SessionsShellInput, SessionsCompactInput, SessionsWaitInput, SessionsStageInput, SessionsClearInput, SessionsCommitInput, SessionsContextInput, SessionsHistoryInput, SessionsHistoryOutput, SessionsEventsInput, SessionsEventsOutput, SessionsInterruptInput, SessionsMessageInput, MessagesListInput, MessagesListOutput, ModelsListInput, ModelsListOutput, ProvidersCatalogInput, ProvidersCatalogOutput, ProvidersListInput, ProvidersListOutput, ProvidersGetInput, ProvidersGetOutput, ProvidersDiscoverCustomInput, ProvidersDiscoverCustomOutput, ProvidersConfigureCustomInput, ProvidersConfigureCustomOutput, IntegrationsListInput, IntegrationsListOutput, IntegrationsGetInput, IntegrationsGetOutput, IntegrationsConnectKeyInput, IntegrationsConnectOauthInput, IntegrationsConnectOauthOutput, IntegrationsAttemptStatusInput, IntegrationsAttemptStatusOutput, IntegrationsAttemptCompleteInput, IntegrationsAttemptCancelInput, CredentialsUpdateInput, CredentialsRemoveInput, PermissionsListRequestsInput, PermissionsListRequestsOutput, PermissionsListSavedInput, PermissionsRemoveSavedInput, PermissionsCreateInput, PermissionsListInput, PermissionsGetInput, PermissionsReplyInput, FilesReadInput, FilesReadOutput, FilesListInput, FilesListOutput, FilesFindInput, FilesFindOutput, CommandsListInput, CommandsListOutput, SkillsListInput, SkillsListOutput, McpsStatusInput, McpsStatusOutput, McpsResourcesInput, McpsResourcesOutput, McpsConnectInput, McpsDisconnectInput, LspStatusInput, LspStatusOutput, ProjectsListOutput, ProjectsInitGitInput, ProjectsInitGitOutput, ProjectsCurrentInput, ProjectsCurrentOutput, ProjectsUpdateInput, ProjectsUpdateOutput, ProjectsDirectoriesInput, ProjectsDirectoriesOutput, WorktreesCreateInput, WorktreesCreateOutput, WorktreesRemoveInput, WorktreesResetInput, CapabilitiesGetOutput, VcsGetInput, VcsGetOutput, VcsStatusInput, VcsStatusOutput, VcsDiffInput, VcsDiffOutput, FormattersStatusInput, FormattersStatusOutput, ConsoleGetInput, ConsoleGetOutput, ConsoleListOrgsInput, ConsoleListOrgsOutput, ConsoleSwitchOrgInput, ConsoleSwitchOrgOutput, ConfigGetInput, ConfigGetOutput, ConfigUpdateInput, ConfigUpdateOutput, WorkspacesListAdaptersInput, WorkspacesListAdaptersOutput, WorkspacesListInput, WorkspacesListOutput, WorkspacesCreateInput, WorkspacesCreateOutput, WorkspacesRemoveInput, WorkspacesRemoveOutput, WorkspacesStatusInput, WorkspacesStatusOutput, WorkspacesSyncListInput, WorkspacesStartInput, WorkspacesWarpInput, ControlPlaneMoveSessionInput, PtysShellsInput, PtysShellsOutput, PtysListInput, PtysListOutput, PtysCreateInput, PtysCreateOutput, PtysGetInput, PtysGetOutput, PtysUpdateInput, PtysUpdateOutput, PtysRemoveInput, QuestionsListRequestsInput, QuestionsListRequestsOutput, QuestionsListInput, QuestionsReplyInput, QuestionsRejectInput, ReferencesListInput, ReferencesListOutput, ProjectCopiesGenerateNameInput, ProjectCopiesGenerateNameOutput, ProjectCopiesCreateInput, ProjectCopiesCreateOutput, ProjectCopiesRemoveInput, ProjectCopiesRefreshInput } from "./types";
export interface ClientOptions {
    readonly baseUrl: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly headers?: HeadersInit;
}
export interface RequestOptions {
    readonly signal?: AbortSignal;
    readonly headers?: HeadersInit;
}
export declare function make(options: ClientOptions): {
    health: {
        get: (requestOptions?: RequestOptions | undefined) => Promise<HealthGetOutput>;
    };
    location: {
        get: (input?: LocationGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<LocationGetOutput>;
        dispose: (input?: LocationDisposeInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    path: {
        get: (input?: PathGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PathGetOutput>;
    };
    agents: {
        list: (input?: AgentsListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<AgentsListOutput>;
    };
    sessions: {
        list: (input?: SessionsListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsListOutput>;
        create: (input?: SessionsCreateInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly parentID?: string | undefined;
            readonly projectID: string;
            readonly agent?: string | undefined;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                readonly created: number;
                readonly updated: number;
                readonly compacting?: number | undefined;
                readonly archived?: number | undefined;
            };
            readonly title: string;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            };
            readonly subpath?: string | undefined;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }>;
        active: (requestOptions?: RequestOptions | undefined) => Promise<{
            readonly [x: string]: {
                readonly type: "running";
            };
        }>;
        get: (input: SessionsGetInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly parentID?: string | undefined;
            readonly projectID: string;
            readonly agent?: string | undefined;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                readonly created: number;
                readonly updated: number;
                readonly compacting?: number | undefined;
                readonly archived?: number | undefined;
            };
            readonly title: string;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            };
            readonly subpath?: string | undefined;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }>;
        children: (input: SessionsChildrenInput, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly id: string;
            readonly parentID?: string | undefined;
            readonly projectID: string;
            readonly agent?: string | undefined;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                readonly created: number;
                readonly updated: number;
                readonly compacting?: number | undefined;
                readonly archived?: number | undefined;
            };
            readonly title: string;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            };
            readonly subpath?: string | undefined;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }[]>;
        todo: (input: SessionsTodoInput, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly content: string;
            readonly status: string;
            readonly priority: string;
        }[]>;
        fork: (input: SessionsForkInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly parentID?: string | undefined;
            readonly projectID: string;
            readonly agent?: string | undefined;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                readonly created: number;
                readonly updated: number;
                readonly compacting?: number | undefined;
                readonly archived?: number | undefined;
            };
            readonly title: string;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            };
            readonly subpath?: string | undefined;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }>;
        update: (input: SessionsUpdateInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly parentID?: string | undefined;
            readonly projectID: string;
            readonly agent?: string | undefined;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                readonly created: number;
                readonly updated: number;
                readonly compacting?: number | undefined;
                readonly archived?: number | undefined;
            };
            readonly title: string;
            readonly share?: {
                readonly url: string;
            } | undefined;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            };
            readonly subpath?: string | undefined;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string | undefined;
                readonly snapshot?: string | undefined;
                readonly diff?: string | undefined;
                readonly files?: readonly {
                    readonly path: string;
                    readonly status: "added" | "deleted" | "modified";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }[] | undefined;
            } | undefined;
        }>;
        remove: (input: SessionsRemoveInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        share: (input: SessionsShareInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly url: string;
        }>;
        unshare: (input: SessionsUnshareInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        switchAgent: (input: SessionsSwitchAgentInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        switchModel: (input: SessionsSwitchModelInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        prompt: (input: SessionsPromptInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly admittedSeq: number;
            readonly id: string;
            readonly sessionID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: import("./types").JsonValue;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly timeCreated: number;
            readonly promotedSeq?: number | undefined;
        }>;
        diff: (input: SessionsDiffInput, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly file?: string | undefined;
            readonly patch?: string | undefined;
            readonly additions: number;
            readonly deletions: number;
            readonly status?: "added" | "deleted" | "modified" | undefined;
        }[]>;
        inputList: (input: SessionsInputListInput, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly admittedSeq: number;
            readonly id: string;
            readonly sessionID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: import("./types").JsonValue;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly timeCreated: number;
            readonly promotedSeq?: number | undefined;
        }[]>;
        inputGet: (input: SessionsInputGetInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly admittedSeq: number;
            readonly id: string;
            readonly sessionID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: import("./types").JsonValue;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly timeCreated: number;
            readonly promotedSeq?: number | undefined;
        }>;
        inputPromote: (input: SessionsInputPromoteInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly admittedSeq: number;
            readonly id: string;
            readonly sessionID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: import("./types").JsonValue;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly timeCreated: number;
            readonly promotedSeq?: number | undefined;
        }>;
        inputCancel: (input: SessionsInputCancelInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        background: (input: SessionsBackgroundInput, requestOptions?: RequestOptions | undefined) => Promise<boolean>;
        command: (input: SessionsCommandInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly admittedSeq: number;
            readonly id: string;
            readonly sessionID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: readonly {
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: import("./types").JsonValue;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly retryCount?: number | undefined;
                } | undefined;
            };
            readonly synthetic?: {
                readonly description: string;
            } | undefined;
            readonly delivery: "queue" | "steer";
            readonly timeCreated: number;
            readonly promotedSeq?: number | undefined;
        }>;
        shell: (input: SessionsShellInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        compact: (input: SessionsCompactInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        wait: (input: SessionsWaitInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        stage: (input: SessionsStageInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly messageID: string;
            readonly partID?: string | undefined;
            readonly snapshot?: string | undefined;
            readonly diff?: string | undefined;
            readonly files?: readonly {
                readonly path: string;
                readonly status: "added" | "deleted" | "modified";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }[] | undefined;
        }>;
        clear: (input: SessionsClearInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        commit: (input: SessionsCommitInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        context: (input: SessionsContextInput, requestOptions?: RequestOptions | undefined) => Promise<readonly ({
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly type: "agent-switched";
            readonly agent: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly type: "model-switched";
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly text: string;
            readonly context?: readonly {
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: import("./types").JsonValue;
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
                    readonly [x: string]: import("./types").JsonValue;
                };
                readonly retryCount?: number | undefined;
            } | undefined;
            readonly type: "user";
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly sessionID: string;
            readonly text: string;
            readonly description?: string | undefined;
            readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            readonly type: "synthetic";
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly type: "system";
            readonly text: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly completed?: number | undefined;
            };
            readonly type: "shell";
            readonly userID?: string | undefined;
            readonly callID: string;
            readonly command: string;
            readonly output: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly completed?: number | undefined;
            };
            readonly type: "assistant";
            readonly agent: string;
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                } | undefined;
                readonly time?: {
                    readonly created: number;
                    readonly completed?: number | undefined;
                } | undefined;
            } | {
                readonly type: "tool";
                readonly id: string;
                readonly name: string;
                readonly provider?: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: import("./types").JsonValue;
                        };
                    } | undefined;
                    readonly resultMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: import("./types").JsonValue;
                        };
                    } | undefined;
                } | undefined;
                readonly state: {
                    readonly status: "pending";
                    readonly input: string;
                } | {
                    readonly status: "running";
                    readonly input: {
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly structured: {
                        readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                        } | undefined;
                    })[];
                } | {
                    readonly status: "completed";
                    readonly input: {
                        readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly outputPaths?: readonly string[] | undefined;
                    readonly structured: {
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly result?: import("./types").JsonValue | undefined;
                } | {
                    readonly status: "error";
                    readonly input: {
                        readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly structured: {
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                    readonly result?: import("./types").JsonValue | undefined;
                };
                readonly time: {
                    readonly created: number;
                    readonly ran?: number | undefined;
                    readonly completed?: number | undefined;
                    readonly pruned?: number | undefined;
                };
            })[];
            readonly snapshot?: {
                readonly start?: string | undefined;
                readonly end?: string | undefined;
                readonly files?: readonly string[] | undefined;
            } | undefined;
            readonly finish?: string | undefined;
            readonly structured?: import("./types").JsonValue | undefined;
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
        } | {
            readonly type: "compaction";
            readonly reason: "auto" | "manual";
            readonly summary: string;
            readonly recent: string;
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
        })[]>;
        history: (input: SessionsHistoryInput, requestOptions?: RequestOptions | undefined) => Promise<SessionsHistoryOutput>;
        events: (input: SessionsEventsInput, requestOptions?: RequestOptions | undefined) => AsyncIterable<SessionsEventsOutput>;
        interrupt: (input: SessionsInterruptInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        message: (input: SessionsMessageInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly type: "agent-switched";
            readonly agent: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly type: "model-switched";
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
                readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly text: string;
            readonly context?: readonly {
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: import("./types").JsonValue;
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
                    readonly [x: string]: import("./types").JsonValue;
                };
                readonly retryCount?: number | undefined;
            } | undefined;
            readonly type: "user";
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly sessionID: string;
            readonly text: string;
            readonly description?: string | undefined;
            readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            readonly type: "synthetic";
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
            readonly type: "system";
            readonly text: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly completed?: number | undefined;
            };
            readonly type: "shell";
            readonly userID?: string | undefined;
            readonly callID: string;
            readonly command: string;
            readonly output: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
                readonly completed?: number | undefined;
            };
            readonly type: "assistant";
            readonly agent: string;
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string | undefined;
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
                        readonly [x: string]: import("./types").JsonValue;
                    };
                } | undefined;
                readonly time?: {
                    readonly created: number;
                    readonly completed?: number | undefined;
                } | undefined;
            } | {
                readonly type: "tool";
                readonly id: string;
                readonly name: string;
                readonly provider?: {
                    readonly executed: boolean;
                    readonly metadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: import("./types").JsonValue;
                        };
                    } | undefined;
                    readonly resultMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: import("./types").JsonValue;
                        };
                    } | undefined;
                } | undefined;
                readonly state: {
                    readonly status: "pending";
                    readonly input: string;
                } | {
                    readonly status: "running";
                    readonly input: {
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly structured: {
                        readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                        } | undefined;
                    })[];
                } | {
                    readonly status: "completed";
                    readonly input: {
                        readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly outputPaths?: readonly string[] | undefined;
                    readonly structured: {
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly result?: import("./types").JsonValue | undefined;
                } | {
                    readonly status: "error";
                    readonly input: {
                        readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
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
                            readonly size?: number | "-Infinity" | "Infinity" | "NaN" | undefined;
                            readonly annotations?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                            readonly meta?: {
                                readonly [x: string]: import("./types").JsonValue;
                            } | undefined;
                        } | undefined;
                    })[];
                    readonly structured: {
                        readonly [x: string]: import("./types").JsonValue;
                    };
                    readonly error: {
                        readonly type: "unknown";
                        readonly message: string;
                    };
                    readonly result?: import("./types").JsonValue | undefined;
                };
                readonly time: {
                    readonly created: number;
                    readonly ran?: number | undefined;
                    readonly completed?: number | undefined;
                    readonly pruned?: number | undefined;
                };
            })[];
            readonly snapshot?: {
                readonly start?: string | undefined;
                readonly end?: string | undefined;
                readonly files?: readonly string[] | undefined;
            } | undefined;
            readonly finish?: string | undefined;
            readonly structured?: import("./types").JsonValue | undefined;
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
        } | {
            readonly type: "compaction";
            readonly reason: "auto" | "manual";
            readonly summary: string;
            readonly recent: string;
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly time: {
                readonly created: number;
            };
        }>;
    };
    messages: {
        list: (input: MessagesListInput, requestOptions?: RequestOptions | undefined) => Promise<MessagesListOutput>;
    };
    models: {
        list: (input?: ModelsListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ModelsListOutput>;
    };
    providers: {
        catalog: (input?: ProvidersCatalogInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ProvidersCatalogOutput>;
        list: (input?: ProvidersListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ProvidersListOutput>;
        get: (input: ProvidersGetInput, requestOptions?: RequestOptions | undefined) => Promise<ProvidersGetOutput>;
        discoverCustom: (input: ProvidersDiscoverCustomInput, requestOptions?: RequestOptions | undefined) => Promise<ProvidersDiscoverCustomOutput>;
        configureCustom: (input: ProvidersConfigureCustomInput, requestOptions?: RequestOptions | undefined) => Promise<ProvidersConfigureCustomOutput>;
    };
    integrations: {
        list: (input?: IntegrationsListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<IntegrationsListOutput>;
        get: (input: IntegrationsGetInput, requestOptions?: RequestOptions | undefined) => Promise<IntegrationsGetOutput>;
        connectKey: (input: IntegrationsConnectKeyInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        connectOauth: (input: IntegrationsConnectOauthInput, requestOptions?: RequestOptions | undefined) => Promise<IntegrationsConnectOauthOutput>;
        attemptStatus: (input: IntegrationsAttemptStatusInput, requestOptions?: RequestOptions | undefined) => Promise<IntegrationsAttemptStatusOutput>;
        attemptComplete: (input: IntegrationsAttemptCompleteInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        attemptCancel: (input: IntegrationsAttemptCancelInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    credentials: {
        update: (input: CredentialsUpdateInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        remove: (input: CredentialsRemoveInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    permissions: {
        listRequests: (input?: PermissionsListRequestsInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PermissionsListRequestsOutput>;
        listSaved: (input?: PermissionsListSavedInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly id: string;
            readonly projectID: string;
            readonly action: string;
            readonly resource: string;
        }[]>;
        removeSaved: (input: PermissionsRemoveSavedInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        create: (input: PermissionsCreateInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly effect: "allow" | "ask" | "deny";
        }>;
        list: (input: PermissionsListInput, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly id: string;
            readonly sessionID: string;
            readonly action: string;
            readonly resources: readonly string[];
            readonly save?: readonly string[] | undefined;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly source?: {
                readonly type: "tool";
                readonly messageID: string;
                readonly callID: string;
            } | undefined;
        }[]>;
        get: (input: PermissionsGetInput, requestOptions?: RequestOptions | undefined) => Promise<{
            readonly id: string;
            readonly sessionID: string;
            readonly action: string;
            readonly resources: readonly string[];
            readonly save?: readonly string[] | undefined;
            readonly metadata?: {
                readonly [x: string]: import("./types").JsonValue;
            } | undefined;
            readonly source?: {
                readonly type: "tool";
                readonly messageID: string;
                readonly callID: string;
            } | undefined;
        }>;
        reply: (input: PermissionsReplyInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    files: {
        read: (input: FilesReadInput, requestOptions?: RequestOptions | undefined) => Promise<FilesReadOutput>;
        list: (input?: FilesListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<FilesListOutput>;
        find: (input: FilesFindInput, requestOptions?: RequestOptions | undefined) => Promise<FilesFindOutput>;
    };
    commands: {
        list: (input?: CommandsListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<CommandsListOutput>;
    };
    skills: {
        list: (input?: SkillsListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SkillsListOutput>;
    };
    mcps: {
        status: (input?: McpsStatusInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpsStatusOutput>;
        resources: (input?: McpsResourcesInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpsResourcesOutput>;
        connect: (input: McpsConnectInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        disconnect: (input: McpsDisconnectInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    lsp: {
        status: (input?: LspStatusInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<LspStatusOutput>;
    };
    projects: {
        list: (requestOptions?: RequestOptions | undefined) => Promise<ProjectsListOutput>;
        initGit: (input?: ProjectsInitGitInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ProjectsInitGitOutput>;
        current: (input?: ProjectsCurrentInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ProjectsCurrentOutput>;
        update: (input: ProjectsUpdateInput, requestOptions?: RequestOptions | undefined) => Promise<ProjectsUpdateOutput>;
        directories: (input: ProjectsDirectoriesInput, requestOptions?: RequestOptions | undefined) => Promise<ProjectsDirectoriesOutput>;
    };
    worktrees: {
        create: (input?: WorktreesCreateInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<WorktreesCreateOutput>;
        remove: (input: WorktreesRemoveInput, requestOptions?: RequestOptions | undefined) => Promise<boolean>;
        reset: (input: WorktreesResetInput, requestOptions?: RequestOptions | undefined) => Promise<boolean>;
    };
    capabilities: {
        get: (requestOptions?: RequestOptions | undefined) => Promise<CapabilitiesGetOutput>;
    };
    vcs: {
        get: (input?: VcsGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<VcsGetOutput>;
        status: (input?: VcsStatusInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<VcsStatusOutput>;
        diff: (input: VcsDiffInput, requestOptions?: RequestOptions | undefined) => Promise<VcsDiffOutput>;
    };
    formatters: {
        status: (input?: FormattersStatusInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<FormattersStatusOutput>;
    };
    console: {
        get: (input?: ConsoleGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConsoleGetOutput>;
        listOrgs: (input?: ConsoleListOrgsInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConsoleListOrgsOutput>;
        switchOrg: (input: ConsoleSwitchOrgInput, requestOptions?: RequestOptions | undefined) => Promise<ConsoleSwitchOrgOutput>;
    };
    config: {
        get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOutput>;
        update: (input: ConfigUpdateInput, requestOptions?: RequestOptions | undefined) => Promise<ConfigUpdateOutput>;
    };
    workspaces: {
        listAdapters: (input?: WorkspacesListAdaptersInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<WorkspacesListAdaptersOutput>;
        list: (input?: WorkspacesListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<WorkspacesListOutput>;
        create: (input: WorkspacesCreateInput, requestOptions?: RequestOptions | undefined) => Promise<WorkspacesCreateOutput>;
        remove: (input: WorkspacesRemoveInput, requestOptions?: RequestOptions | undefined) => Promise<WorkspacesRemoveOutput>;
        status: (input?: WorkspacesStatusInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<WorkspacesStatusOutput>;
        syncList: (input?: WorkspacesSyncListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<void>;
        start: (input?: WorkspacesStartInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<void>;
        warp: (input: WorkspacesWarpInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    controlPlane: {
        moveSession: (input: ControlPlaneMoveSessionInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    events: {
        subscribe: (requestOptions?: RequestOptions | undefined) => AsyncIterable<{
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly reason: "auto" | "manual";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly agent: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly reason: "auto" | "manual";
                readonly text: string;
                readonly recent: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly text: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly message: {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                    };
                    readonly type: "agent-switched";
                    readonly agent: string;
                } | {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                    };
                    readonly type: "model-switched";
                    readonly model: {
                        readonly id: string;
                        readonly providerID: string;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                } | {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
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
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                    };
                    readonly sessionID: string;
                    readonly text: string;
                    readonly description?: string | undefined;
                    readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
                    readonly type: "synthetic";
                } | {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                    };
                    readonly type: "system";
                    readonly text: string;
                } | {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly type: "shell";
                    readonly userID?: string | undefined;
                    readonly callID: string;
                    readonly command: string;
                    readonly output: string;
                    readonly time: {
                        readonly created: number;
                        readonly completed?: number | undefined;
                    };
                } | {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly type: "assistant";
                    readonly agent: string;
                    readonly model: {
                        readonly id: string;
                        readonly providerID: string;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                    readonly content: readonly ({
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
                            readonly created: number;
                            readonly ran?: number | undefined;
                            readonly completed?: number | undefined;
                            readonly pruned?: number | undefined;
                        };
                    } | {
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
                            readonly created: number;
                            readonly completed?: number | undefined;
                        } | undefined;
                    })[];
                    readonly snapshot?: {
                        readonly start?: string | undefined;
                        readonly end?: string | undefined;
                        readonly files?: readonly string[] | undefined;
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
                        readonly created: number;
                        readonly completed?: number | undefined;
                    };
                } | {
                    readonly id: string;
                    readonly metadata?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                    readonly time: {
                        readonly created: number;
                    };
                    readonly type: "compaction";
                    readonly reason: "auto" | "manual";
                    readonly summary: string;
                    readonly recent: string;
                };
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly model: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly location: {
                    readonly directory: string;
                    readonly workspaceID?: string | undefined;
                };
                readonly subdirectory?: string | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
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
                } | undefined;
                readonly delivery: "queue" | "steer";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
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
                } | undefined;
                readonly delivery: "queue" | "steer";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly attemptID: string;
                readonly assistantMessageID: string;
                readonly outcome: "abandoned" | "completed" | "failed" | "interrupted";
                readonly continuation: boolean;
                readonly error?: {
                    readonly type: "unknown";
                    readonly message: string;
                } | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly attemptID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly attemptID: string;
                readonly assistantMessageID: string;
                readonly attempt: number;
                readonly retryOf?: string | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly attemptID: string;
                readonly decision: "abandon" | "retry";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly reasoningID: string;
                readonly text: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly reasoningID: string;
                readonly providerMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: unknown;
                    };
                } | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly attemptID: string;
                readonly attempt: number;
                readonly next: number;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly revert: {
                    readonly messageID: string;
                    readonly partID?: string | undefined;
                    readonly snapshot?: string | undefined;
                    readonly diff?: string | undefined;
                    readonly files?: readonly {
                        readonly path: string;
                        readonly status: "added" | "deleted" | "modified";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }[] | undefined;
                };
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly callID: string;
                readonly output: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly userID?: string | undefined;
                readonly callID: string;
                readonly command: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
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
                readonly files?: readonly string[] | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly agent: string;
                readonly model: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string | undefined;
                    readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                };
                readonly snapshot?: string | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly text: string;
                readonly kind?: "build-switch" | "plan-approved" | "plan-mode" | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly textID: string;
                readonly text: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly textID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly callID: string;
                readonly text: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly callID: string;
                readonly name: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
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
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "message.part.delta";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly messageID: string;
                readonly partID: string;
                readonly field: string;
                readonly delta: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly messageID: string;
                readonly partID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly part: {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
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
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
                    readonly type: "subtask";
                    readonly prompt: string;
                    readonly description: string;
                    readonly agent: string;
                    readonly model?: {
                        readonly providerID: string;
                        readonly modelID: string;
                    } | undefined;
                    readonly command?: string | undefined;
                } | {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
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
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
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
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
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
                            readonly id: string;
                            readonly sessionID: string;
                            readonly messageID: string;
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
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
                    readonly type: "step-start";
                    readonly snapshot?: string | undefined;
                } | {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
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
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
                    readonly type: "snapshot";
                    readonly snapshot: string;
                } | {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
                    readonly type: "patch";
                    readonly hash: string;
                    readonly files: readonly string[];
                } | {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
                    readonly type: "agent";
                    readonly name: string;
                    readonly source?: {
                        readonly value: string;
                        readonly start: number;
                        readonly end: number;
                    } | undefined;
                } | {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
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
                    readonly id: string;
                    readonly sessionID: string;
                    readonly messageID: string;
                    readonly type: "compaction";
                    readonly auto: boolean;
                    readonly overflow?: boolean | undefined;
                    readonly tail_start_id?: string | undefined;
                };
                readonly time: number;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly messageID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly info: {
                    readonly id: string;
                    readonly sessionID: string;
                    readonly role: "user";
                    readonly time: {
                        readonly created: number;
                    };
                    readonly format?: {
                        readonly type: "text";
                    } | {
                        readonly type: "json_schema";
                        readonly schema: {
                            readonly [x: string]: any;
                        };
                        readonly retryCount?: number | undefined;
                    } | undefined;
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
                        readonly providerID: string;
                        readonly modelID: string;
                        readonly variant?: string | undefined;
                        readonly protocol?: "anthropic-messages" | "openai-compatible" | "openai-responses" | undefined;
                    };
                    readonly system?: string | undefined;
                    readonly tools?: {
                        readonly [x: string]: boolean;
                    } | undefined;
                } | {
                    readonly id: string;
                    readonly sessionID: string;
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
                    readonly parentID: string;
                    readonly modelID: string;
                    readonly providerID: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly info: {
                    readonly id: string;
                    readonly slug: string;
                    readonly projectID: string;
                    readonly workspaceID?: string | undefined;
                    readonly directory: string;
                    readonly path?: string | undefined;
                    readonly parentID?: string | undefined;
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
                        readonly id: string;
                        readonly providerID: string;
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
                        readonly messageID: string;
                        readonly partID?: string | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly info: {
                    readonly id: string;
                    readonly slug: string;
                    readonly projectID: string;
                    readonly workspaceID?: string | undefined;
                    readonly directory: string;
                    readonly path?: string | undefined;
                    readonly parentID?: string | undefined;
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
                        readonly id: string;
                        readonly providerID: string;
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
                        readonly messageID: string;
                        readonly partID?: string | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.diff";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly diff: readonly {
                    readonly file?: string | undefined;
                    readonly patch?: string | undefined;
                    readonly additions: number;
                    readonly deletions: number;
                    readonly status?: "added" | "deleted" | "modified" | undefined;
                }[];
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.error";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID?: string | undefined;
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
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly info: {
                    readonly id: string;
                    readonly slug: string;
                    readonly projectID: string;
                    readonly workspaceID?: string | undefined;
                    readonly directory: string;
                    readonly path?: string | undefined;
                    readonly parentID?: string | undefined;
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
                        readonly id: string;
                        readonly providerID: string;
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
                        readonly messageID: string;
                        readonly partID?: string | undefined;
                        readonly snapshot?: string | undefined;
                        readonly diff?: string | undefined;
                    } | undefined;
                };
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "question.asked";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
                readonly sessionID: string;
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
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "question.rejected";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly requestID: string;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "question.replied";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly requestID: string;
                readonly answers: readonly (readonly string[])[];
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.compacted";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly message: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly name: string;
                readonly branch?: string | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly integrationID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly messageID: string;
                readonly text: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly reasoningID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly callID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly textID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly timestamp: number;
                readonly sessionID: string;
                readonly assistantMessageID: string;
                readonly callID: string;
                readonly delta: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly file: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
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
                readonly id: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly requestID: string;
                readonly reply: "always" | "once" | "reject";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly projectID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly file: string;
                readonly event: "add" | "change" | "unlink";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly info: {
                    readonly id: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
                readonly exitCode: number;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly info: {
                    readonly id: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
                readonly sessionID: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly requestID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly requestID: string;
                readonly answers: readonly (readonly string[])[];
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly todos: readonly {
                    readonly content: string;
                    readonly status: string;
                    readonly priority: string;
                }[];
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "permission.asked";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly id: string;
                readonly sessionID: string;
                readonly permission: string;
                readonly patterns: readonly string[];
                readonly metadata: {
                    readonly [x: string]: unknown;
                };
                readonly always: readonly string[];
                readonly tool?: {
                    readonly messageID: string;
                    readonly callID: string;
                } | undefined;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "permission.replied";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
                readonly requestID: string;
                readonly reply: "always" | "once" | "reject";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly command: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly text: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly title?: string | undefined;
                readonly message: string;
                readonly variant: "error" | "info" | "success" | "warning";
                readonly duration?: number | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly mcpName: string;
                readonly url: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly server: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly name: string;
                readonly sessionID: string;
                readonly arguments: string;
                readonly messageID: string;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.idle";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly type: "session.status";
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly sessionID: string;
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
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly branch?: string | undefined;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly message: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly name: string;
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {
                readonly workspaceID: string;
                readonly status: "connected" | "connecting" | "disconnected" | "error";
            };
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
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
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly data: {};
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            } | undefined;
            readonly durable?: {
                readonly aggregateID: string;
                readonly seq: number;
                readonly version: number;
            } | undefined;
            readonly location?: {
                readonly directory: string;
                readonly workspaceID?: string | undefined;
            } | undefined;
            readonly type: "server.connected";
            readonly data: {};
        }>;
    };
    ptys: {
        shells: (input?: PtysShellsInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PtysShellsOutput>;
        list: (input?: PtysListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PtysListOutput>;
        create: (input?: PtysCreateInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PtysCreateOutput>;
        get: (input: PtysGetInput, requestOptions?: RequestOptions | undefined) => Promise<PtysGetOutput>;
        update: (input: PtysUpdateInput, requestOptions?: RequestOptions | undefined) => Promise<PtysUpdateOutput>;
        remove: (input: PtysRemoveInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    questions: {
        listRequests: (input?: QuestionsListRequestsInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<QuestionsListRequestsOutput>;
        list: (input: QuestionsListInput, requestOptions?: RequestOptions | undefined) => Promise<readonly {
            readonly id: string;
            readonly sessionID: string;
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
        }[]>;
        reply: (input: QuestionsReplyInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        reject: (input: QuestionsRejectInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
    references: {
        list: (input?: ReferencesListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ReferencesListOutput>;
    };
    projectCopies: {
        generateName: (input: ProjectCopiesGenerateNameInput, requestOptions?: RequestOptions | undefined) => Promise<ProjectCopiesGenerateNameOutput>;
        create: (input: ProjectCopiesCreateInput, requestOptions?: RequestOptions | undefined) => Promise<ProjectCopiesCreateOutput>;
        remove: (input: ProjectCopiesRemoveInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
        refresh: (input: ProjectCopiesRefreshInput, requestOptions?: RequestOptions | undefined) => Promise<void>;
    };
};
