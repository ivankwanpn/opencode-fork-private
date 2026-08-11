import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event";
export type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | {
    readonly [key: string]: JsonValue;
};
export type UnauthorizedError = {
    readonly _tag: "UnauthorizedError";
    readonly message: string;
};
export declare const isUnauthorizedError: (value: unknown) => value is UnauthorizedError;
export type InvalidRequestError = {
    readonly _tag: "InvalidRequestError";
    readonly message: string;
    readonly kind?: string | undefined;
    readonly field?: string | undefined;
};
export declare const isInvalidRequestError: (value: unknown) => value is InvalidRequestError;
export type InvalidCursorError = {
    readonly _tag: "InvalidCursorError";
    readonly message: string;
};
export declare const isInvalidCursorError: (value: unknown) => value is InvalidCursorError;
export type SessionNotFoundError = {
    readonly _tag: "SessionNotFoundError";
    readonly sessionID: string;
    readonly message: string;
};
export declare const isSessionNotFoundError: (value: unknown) => value is SessionNotFoundError;
export type MessageNotFoundError = {
    readonly _tag: "MessageNotFoundError";
    readonly sessionID: string;
    readonly messageID: string;
    readonly message: string;
};
export declare const isMessageNotFoundError: (value: unknown) => value is MessageNotFoundError;
export type UnknownError = {
    readonly _tag: "UnknownError";
    readonly message: string;
    readonly ref?: string | undefined;
};
export declare const isUnknownError: (value: unknown) => value is UnknownError;
export type ServiceUnavailableError = {
    readonly _tag: "ServiceUnavailableError";
    readonly message: string;
    readonly service?: string | undefined;
};
export declare const isServiceUnavailableError: (value: unknown) => value is ServiceUnavailableError;
export type ConflictError = {
    readonly _tag: "ConflictError";
    readonly message: string;
    readonly resource?: string | undefined;
};
export declare const isConflictError: (value: unknown) => value is ConflictError;
export type SessionTurnConflictError = {
    readonly _tag: "SessionTurnConflictError";
    readonly sessionID: string;
    readonly reason: "already-active" | "no-active" | "mismatch";
    readonly turnID?: string | undefined;
    readonly expectedTurnID?: string | undefined;
    readonly message: string;
};
export declare const isSessionTurnConflictError: (value: unknown) => value is SessionTurnConflictError;
export type SessionInputNotFoundError = {
    readonly _tag: "SessionInputNotFoundError";
    readonly sessionID: string;
    readonly inputID: string;
    readonly message: string;
};
export declare const isSessionInputNotFoundError: (value: unknown) => value is SessionInputNotFoundError;
export type SessionInputConflictError = {
    readonly _tag: "SessionInputConflictError";
    readonly sessionID: string;
    readonly inputID: string;
    readonly message: string;
};
export declare const isSessionInputConflictError: (value: unknown) => value is SessionInputConflictError;
export type ProviderNotFoundError = {
    readonly _tag: "ProviderNotFoundError";
    readonly providerID: string;
    readonly message: string;
};
export declare const isProviderNotFoundError: (value: unknown) => value is ProviderNotFoundError;
export type ProviderModelDiscoveryError = {
    readonly _tag: "ProviderModelDiscoveryError";
    readonly providerID: string;
    readonly kind: "unsupported" | "missing-credential" | "authentication" | "network" | "timeout" | "invalid" | "empty";
    readonly message: string;
};
export declare const isProviderModelDiscoveryError: (value: unknown) => value is ProviderModelDiscoveryError;
export type CustomProviderValidationError = {
    readonly _tag: "CustomProviderValidationError";
    readonly message: string;
    readonly field: string;
};
export declare const isCustomProviderValidationError: (value: unknown) => value is CustomProviderValidationError;
export type CustomProviderDiscoveryError = {
    readonly _tag: "CustomProviderDiscoveryError";
    readonly message: string;
    readonly endpoint?: string;
    readonly status?: number;
    readonly kind: "network" | "timeout" | "redirect" | "status" | "shape" | "environment";
};
export declare const isCustomProviderDiscoveryError: (value: unknown) => value is CustomProviderDiscoveryError;
export type CustomProviderConflictError = {
    readonly _tag: "CustomProviderConflictError";
    readonly message: string;
    readonly providerID: string;
};
export declare const isCustomProviderConflictError: (value: unknown) => value is CustomProviderConflictError;
export type CustomProviderConfigureError = {
    readonly _tag: "CustomProviderConfigureError";
    readonly message: string;
    readonly stage: "config" | "legacyCredential" | "nativeCredential" | "catalogRefresh" | "rollback";
    readonly recoveryWarning?: string;
};
export declare const isCustomProviderConfigureError: (value: unknown) => value is CustomProviderConfigureError;
export type PermissionNotFoundError = {
    readonly _tag: "PermissionNotFoundError";
    readonly requestID: string;
    readonly message: string;
};
export declare const isPermissionNotFoundError: (value: unknown) => value is PermissionNotFoundError;
export type McpNotFoundError = {
    readonly _tag: "McpNotFoundError";
    readonly name: string;
    readonly message: string;
};
export declare const isMcpNotFoundError: (value: unknown) => value is McpNotFoundError;
export type ProjectOperationError = {
    readonly name: "ProjectOperationError";
    readonly data: {
        readonly message: string;
    };
};
export declare const isProjectOperationError: (value: unknown) => value is ProjectOperationError;
export type ProjectNotFoundError = {
    readonly _tag: "ProjectNotFoundError";
    readonly projectID: string;
    readonly message: string;
};
export declare const isProjectNotFoundError: (value: unknown) => value is ProjectNotFoundError;
export type WorktreeOperationError = {
    readonly name: "WorktreeOperationError";
    readonly data: {
        readonly message: string;
    };
};
export declare const isWorktreeOperationError: (value: unknown) => value is WorktreeOperationError;
export type PtyNotFoundError = {
    readonly _tag: "PtyNotFoundError";
    readonly ptyID: string;
    readonly message: string;
};
export declare const isPtyNotFoundError: (value: unknown) => value is PtyNotFoundError;
export type QuestionNotFoundError = {
    readonly _tag: "QuestionNotFoundError";
    readonly requestID: string;
    readonly message: string;
};
export declare const isQuestionNotFoundError: (value: unknown) => value is QuestionNotFoundError;
export type ProjectCopyError = {
    readonly name: "ProjectCopyError";
    readonly data: {
        readonly message: string;
        readonly forceRequired?: boolean | undefined;
    };
};
export declare const isProjectCopyError: (value: unknown) => value is ProjectCopyError;
export type HealthGetOutput = {
    readonly healthy: true;
    readonly pid: number;
};
export type LocationGetInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type LocationGetOutput = {
    readonly directory: string;
    readonly workspaceID?: string;
    readonly project: {
        readonly id: string;
        readonly directory: string;
    };
};
export type LocationDisposeInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type LocationDisposeOutput = void;
export type PathGetInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type PathGetOutput = {
    readonly home: string;
    readonly state: string;
    readonly config: string;
    readonly worktree: string;
    readonly directory: string;
};
export type AgentsListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type AgentsListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
        readonly request: {
            readonly headers: {
                readonly [x: string]: string;
            };
            readonly body: {
                readonly [x: string]: JsonValue;
            };
        };
        readonly system?: string;
        readonly description?: string;
        readonly mode: "subagent" | "primary" | "all";
        readonly hidden: boolean;
        readonly color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info";
        readonly steps?: number;
        readonly permissions: ReadonlyArray<{
            readonly action: string;
            readonly resource: string;
            readonly effect: "allow" | "deny" | "ask";
        }>;
    }>;
};
export type SessionsListInput = {
    readonly workspace?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["workspace"];
    readonly limit?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["limit"];
    readonly order?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["order"];
    readonly search?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["search"];
    readonly parentID?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["parentID"];
    readonly directory?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["directory"];
    readonly project?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["project"];
    readonly subpath?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["subpath"];
    readonly cursor?: {
        readonly workspace?: string | undefined;
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly search?: string | undefined;
        readonly parentID?: null | string | undefined;
        readonly directory?: string | undefined;
        readonly project?: string | undefined;
        readonly subpath?: string | undefined;
        readonly cursor?: string | undefined;
    }["cursor"];
};
export type SessionsListOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly parentID?: string;
        readonly projectID: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
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
            readonly compacting?: number;
            readonly archived?: number;
        };
        readonly title: string;
        readonly share?: {
            readonly url: string;
        };
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subpath?: string;
        readonly revert?: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    }>;
    readonly cursor: {
        readonly previous?: string | null;
        readonly next?: string | null;
    };
};
export type SessionsCreateInput = {
    readonly id?: {
        readonly id?: string | null;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        } | null;
    }["id"];
    readonly agent?: {
        readonly id?: string | null;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        } | null;
    }["agent"];
    readonly model?: {
        readonly id?: string | null;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        } | null;
    }["model"];
    readonly location?: {
        readonly id?: string | null;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        } | null;
    }["location"];
};
export type SessionsCreateOutput = {
    readonly data: {
        readonly id: string;
        readonly parentID?: string;
        readonly projectID: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
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
            readonly compacting?: number;
            readonly archived?: number;
        };
        readonly title: string;
        readonly share?: {
            readonly url: string;
        };
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subpath?: string;
        readonly revert?: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    };
}["data"];
export type SessionsActiveOutput = {
    readonly data: {
        readonly [x: string]: {
            readonly type: "running";
            readonly turnID?: string | undefined;
            readonly phase?: "pending" | "active" | undefined;
        };
    };
}["data"];
export type SessionsGetInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsGetOutput = {
    readonly data: {
        readonly id: string;
        readonly parentID?: string;
        readonly projectID: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
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
            readonly compacting?: number;
            readonly archived?: number;
        };
        readonly title: string;
        readonly share?: {
            readonly url: string;
        };
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subpath?: string;
        readonly revert?: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    };
}["data"];
export type SessionsChildrenInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsChildrenOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly parentID?: string;
        readonly projectID: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
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
            readonly compacting?: number;
            readonly archived?: number;
        };
        readonly title: string;
        readonly share?: {
            readonly url: string;
        };
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subpath?: string;
        readonly revert?: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    }>;
}["data"];
export type SessionsTodoInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsTodoOutput = {
    readonly data: ReadonlyArray<{
        readonly content: string;
        readonly status: string;
        readonly priority: string;
    }>;
}["data"];
export type SessionsForkInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly messageID?: {
        readonly messageID?: string | undefined;
    }["messageID"];
};
export type SessionsForkOutput = {
    readonly data: {
        readonly id: string;
        readonly parentID?: string;
        readonly projectID: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
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
            readonly compacting?: number;
            readonly archived?: number;
        };
        readonly title: string;
        readonly share?: {
            readonly url: string;
        };
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subpath?: string;
        readonly revert?: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    };
}["data"];
export type SessionsUpdateInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly title?: {
        readonly title?: string | null;
        readonly archived?: number | null | null;
    }["title"];
    readonly archived?: {
        readonly title?: string | null;
        readonly archived?: number | null | null;
    }["archived"];
};
export type SessionsUpdateOutput = {
    readonly data: {
        readonly id: string;
        readonly parentID?: string;
        readonly projectID: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
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
            readonly compacting?: number;
            readonly archived?: number;
        };
        readonly title: string;
        readonly share?: {
            readonly url: string;
        };
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subpath?: string;
        readonly revert?: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    };
}["data"];
export type SessionsRemoveInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsRemoveOutput = void;
export type SessionsShareInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsShareOutput = {
    readonly data: {
        readonly url: string;
    };
}["data"];
export type SessionsUnshareInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsUnshareOutput = void;
export type SessionsSwitchAgentInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly agent: {
        readonly agent: string;
    }["agent"];
};
export type SessionsSwitchAgentOutput = void;
export type SessionsSwitchModelInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly model: {
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
    }["model"];
};
export type SessionsSwitchModelOutput = void;
export type SessionsPromptInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly id?: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["id"];
    readonly prompt: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["prompt"];
    readonly model?: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["model"];
    readonly delivery?: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["delivery"];
    readonly intent?: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["intent"];
    readonly expectedActiveAttemptID?: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["expectedActiveAttemptID"];
    readonly resume?: {
        readonly id?: string | null;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
    }["resume"];
};
export type SessionsPromptOutput = {
    readonly data: {
        readonly admittedSeq: number;
        readonly id: string;
        readonly sessionID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
        readonly timeCreated: number;
        readonly promotedSeq?: number;
    };
}["data"];
export type SessionsDiffInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly messageID?: {
        readonly messageID?: string | undefined;
    }["messageID"];
};
export type SessionsDiffOutput = {
    readonly data: ReadonlyArray<{
        readonly file?: string;
        readonly patch?: string;
        readonly additions: number;
        readonly deletions: number;
        readonly status?: "added" | "deleted" | "modified";
    }>;
}["data"];
export type SessionsInputListInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly delivery?: {
        readonly delivery?: "steer" | "queue" | undefined;
    }["delivery"];
};
export type SessionsInputListOutput = {
    readonly data: ReadonlyArray<{
        readonly admittedSeq: number;
        readonly id: string;
        readonly sessionID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
        readonly timeCreated: number;
        readonly promotedSeq?: number;
    }>;
}["data"];
export type SessionsInputGetInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly inputID: string;
    }["sessionID"];
    readonly inputID: {
        readonly sessionID: string;
        readonly inputID: string;
    }["inputID"];
};
export type SessionsInputGetOutput = {
    readonly data: {
        readonly admittedSeq: number;
        readonly id: string;
        readonly sessionID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
        readonly timeCreated: number;
        readonly promotedSeq?: number;
    };
}["data"];
export type SessionsInputPromoteInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly inputID: string;
    }["sessionID"];
    readonly inputID: {
        readonly sessionID: string;
        readonly inputID: string;
    }["inputID"];
};
export type SessionsInputPromoteOutput = {
    readonly data: {
        readonly admittedSeq: number;
        readonly id: string;
        readonly sessionID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
        readonly timeCreated: number;
        readonly promotedSeq?: number;
    };
}["data"];
export type SessionsInputCancelInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly inputID: string;
    }["sessionID"];
    readonly inputID: {
        readonly sessionID: string;
        readonly inputID: string;
    }["inputID"];
};
export type SessionsInputCancelOutput = void;
export type SessionsBackgroundInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsBackgroundOutput = boolean;
export type SessionsCommandInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly id?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["id"];
    readonly command: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["command"];
    readonly arguments: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["arguments"];
    readonly agent?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["agent"];
    readonly model?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["model"];
    readonly files?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["files"];
    readonly delivery?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["delivery"];
    readonly intent?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["intent"];
    readonly expectedActiveAttemptID?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["expectedActiveAttemptID"];
    readonly resume?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["resume"];
    readonly commit?: {
        readonly id?: string | null;
        readonly command: string;
        readonly arguments: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime?: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
        }> | null;
        readonly delivery?: "steer" | "queue" | null;
        readonly intent?: ({
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        }) | null;
        readonly expectedActiveAttemptID?: string | null;
        readonly resume?: boolean | null;
        readonly commit?: boolean | null;
    }["commit"];
};
export type SessionsCommandOutput = {
    readonly data: {
        readonly admittedSeq: number;
        readonly id: string;
        readonly sessionID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: JsonValue;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
        readonly timeCreated: number;
        readonly promotedSeq?: number;
    };
}["data"];
export type SessionsShellInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly id?: {
        readonly id?: string | null;
        readonly userID?: string | null;
        readonly command: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly resume?: boolean | null;
    }["id"];
    readonly userID?: {
        readonly id?: string | null;
        readonly userID?: string | null;
        readonly command: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly resume?: boolean | null;
    }["userID"];
    readonly command: {
        readonly id?: string | null;
        readonly userID?: string | null;
        readonly command: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly resume?: boolean | null;
    }["command"];
    readonly agent?: {
        readonly id?: string | null;
        readonly userID?: string | null;
        readonly command: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly resume?: boolean | null;
    }["agent"];
    readonly model?: {
        readonly id?: string | null;
        readonly userID?: string | null;
        readonly command: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly resume?: boolean | null;
    }["model"];
    readonly resume?: {
        readonly id?: string | null;
        readonly userID?: string | null;
        readonly command: string;
        readonly agent?: string | null;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        } | null;
        readonly resume?: boolean | null;
    }["resume"];
};
export type SessionsShellOutput = void;
export type SessionsCompactInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsCompactOutput = void;
export type SessionsWaitInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsWaitOutput = void;
export type SessionsStageInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly messageID: {
        readonly messageID: string;
        readonly files?: boolean | undefined;
    }["messageID"];
    readonly files?: {
        readonly messageID: string;
        readonly files?: boolean | undefined;
    }["files"];
};
export type SessionsStageOutput = {
    readonly data: {
        readonly messageID: string;
        readonly partID?: string;
        readonly snapshot?: string;
        readonly diff?: string;
        readonly files?: ReadonlyArray<{
            readonly path: string;
            readonly status: "added" | "modified" | "deleted";
            readonly additions: number;
            readonly deletions: number;
            readonly patch: string;
        }>;
    };
}["data"];
export type SessionsClearInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsClearOutput = void;
export type SessionsCommitInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsCommitOutput = void;
export type SessionsContextInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsContextOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "agent-switched";
        readonly agent: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "model-switched";
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly text: string;
        readonly context?: ReadonlyArray<{
            readonly text: string;
            readonly metadata?: {
                readonly [x: string]: JsonValue;
            };
        }>;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
            readonly materialized?: ReadonlyArray<{
                readonly type: "text";
                readonly text: string;
            } | {
                readonly type: "file";
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
            } | {
                readonly type: "error";
                readonly message: string;
            }>;
        }>;
        readonly agents?: ReadonlyArray<{
            readonly name: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly guidance?: string;
        }>;
        readonly system?: string;
        readonly tools?: {
            readonly [x: string]: boolean;
        };
        readonly format?: {
            readonly type: "text";
        } | {
            readonly type: "json_schema";
            readonly schema: {
                readonly [x: string]: JsonValue;
            };
            readonly retryCount?: number;
        };
        readonly type: "user";
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly sessionID: string;
        readonly text: string;
        readonly description?: string;
        readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
        readonly type: "synthetic";
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "system";
        readonly text: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
            readonly completed?: number;
        };
        readonly type: "shell";
        readonly userID?: string;
        readonly callID: string;
        readonly command: string;
        readonly output: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
            readonly completed?: number;
        };
        readonly type: "assistant";
        readonly agent: string;
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
        readonly content: ReadonlyArray<{
            readonly type: "text";
            readonly id: string;
            readonly text: string;
        } | {
            readonly type: "reasoning";
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?: {
                readonly [x: string]: {
                    readonly [x: string]: JsonValue;
                };
            };
            readonly time?: {
                readonly created: number;
                readonly completed?: number;
            };
        } | {
            readonly type: "tool";
            readonly id: string;
            readonly name: string;
            readonly provider?: {
                readonly executed: boolean;
                readonly metadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
                readonly resultMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
            readonly state: {
                readonly status: "pending";
                readonly input: string;
            } | {
                readonly status: "running";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
            } | {
                readonly status: "completed";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly attachments?: ReadonlyArray<{
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    };
                    readonly materialized?: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    }>;
                }>;
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
                readonly outputPaths?: ReadonlyArray<string>;
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly result?: JsonValue;
            } | {
                readonly status: "error";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
                readonly result?: JsonValue;
            };
            readonly time: {
                readonly created: number;
                readonly ran?: number;
                readonly completed?: number;
                readonly pruned?: number;
            };
        }>;
        readonly snapshot?: {
            readonly start?: string;
            readonly end?: string;
            readonly files?: ReadonlyArray<string>;
            readonly patch?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
        readonly finish?: string;
        readonly structured?: JsonValue;
        readonly cost?: number;
        readonly tokens?: {
            readonly input: number;
            readonly output: number;
            readonly reasoning: number;
            readonly cache: {
                readonly read: number;
                readonly write: number;
            };
        };
        readonly error?: {
            readonly type: "unknown";
            readonly message: string;
        };
    } | {
        readonly type: "compaction";
        readonly reason: "auto" | "manual";
        readonly summary: string;
        readonly recent: string;
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
    }>;
}["data"];
export type SessionsHistoryInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly limit?: {
        readonly limit?: number | undefined;
        readonly after?: number | undefined;
    }["limit"];
    readonly after?: {
        readonly limit?: number | undefined;
        readonly after?: number | undefined;
    }["after"];
};
export type SessionsHistoryOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.created";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly info: {
                readonly id: string;
                readonly parentID?: string;
                readonly projectID: string;
                readonly slug: string;
                readonly version: string;
                readonly agent?: string;
                readonly model?: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string;
                    readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
                };
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
                    readonly compacting?: number;
                    readonly archived?: number;
                };
                readonly title: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly share?: {
                    readonly url: string;
                };
                readonly permission?: ReadonlyArray<{
                    readonly action: string;
                    readonly resource: string;
                    readonly effect: "allow" | "deny" | "ask";
                }>;
                readonly location: {
                    readonly directory: string;
                    readonly workspaceID?: string;
                };
                readonly subpath?: string;
                readonly revert?: {
                    readonly messageID: string;
                    readonly partID?: string;
                    readonly snapshot?: string;
                    readonly diff?: string;
                    readonly files?: ReadonlyArray<{
                        readonly path: string;
                        readonly status: "added" | "modified" | "deleted";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }>;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.updated";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly info: {
                readonly id: string;
                readonly parentID?: string;
                readonly projectID: string;
                readonly slug: string;
                readonly version: string;
                readonly agent?: string;
                readonly model?: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string;
                    readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
                };
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
                    readonly compacting?: number;
                    readonly archived?: number;
                };
                readonly title: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly share?: {
                    readonly url: string;
                };
                readonly permission?: ReadonlyArray<{
                    readonly action: string;
                    readonly resource: string;
                    readonly effect: "allow" | "deny" | "ask";
                }>;
                readonly location: {
                    readonly directory: string;
                    readonly workspaceID?: string;
                };
                readonly subpath?: string;
                readonly revert?: {
                    readonly messageID: string;
                    readonly partID?: string;
                    readonly snapshot?: string;
                    readonly diff?: string;
                    readonly files?: ReadonlyArray<{
                        readonly path: string;
                        readonly status: "added" | "modified" | "deleted";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }>;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.deleted";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly info: {
                readonly id: string;
                readonly parentID?: string;
                readonly projectID: string;
                readonly slug: string;
                readonly version: string;
                readonly agent?: string;
                readonly model?: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string;
                    readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
                };
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
                    readonly compacting?: number;
                    readonly archived?: number;
                };
                readonly title: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly share?: {
                    readonly url: string;
                };
                readonly permission?: ReadonlyArray<{
                    readonly action: string;
                    readonly resource: string;
                    readonly effect: "allow" | "deny" | "ask";
                }>;
                readonly location: {
                    readonly directory: string;
                    readonly workspaceID?: string;
                };
                readonly subpath?: string;
                readonly revert?: {
                    readonly messageID: string;
                    readonly partID?: string;
                    readonly snapshot?: string;
                    readonly diff?: string;
                    readonly files?: ReadonlyArray<{
                        readonly path: string;
                        readonly status: "added" | "modified" | "deleted";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }>;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.status";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
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
                    readonly link?: string;
                };
                readonly next: number;
            } | {
                readonly type: "busy";
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.agent.switched";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly agent: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.model.switched";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.moved";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string;
            };
            readonly subdirectory?: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.message.imported";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly message: {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                };
                readonly type: "agent-switched";
                readonly agent: string;
            } | {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                };
                readonly type: "model-switched";
                readonly model: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string;
                    readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
                };
            } | {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                };
                readonly text: string;
                readonly context?: ReadonlyArray<{
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: JsonValue;
                    };
                }>;
                readonly files?: ReadonlyArray<{
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    };
                    readonly materialized?: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    }>;
                }>;
                readonly agents?: ReadonlyArray<{
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly guidance?: string;
                }>;
                readonly system?: string;
                readonly tools?: {
                    readonly [x: string]: boolean;
                };
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly retryCount?: number;
                };
                readonly type: "user";
            } | {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                };
                readonly sessionID: string;
                readonly text: string;
                readonly description?: string;
                readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
                readonly type: "synthetic";
            } | {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                };
                readonly type: "system";
                readonly text: string;
            } | {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                    readonly completed?: number;
                };
                readonly type: "shell";
                readonly userID?: string;
                readonly callID: string;
                readonly command: string;
                readonly output: string;
            } | {
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                    readonly completed?: number;
                };
                readonly type: "assistant";
                readonly agent: string;
                readonly model: {
                    readonly id: string;
                    readonly providerID: string;
                    readonly variant?: string;
                    readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly id: string;
                    readonly text: string;
                } | {
                    readonly type: "reasoning";
                    readonly id: string;
                    readonly text: string;
                    readonly providerMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                    readonly time?: {
                        readonly created: number;
                        readonly completed?: number;
                    };
                } | {
                    readonly type: "tool";
                    readonly id: string;
                    readonly name: string;
                    readonly provider?: {
                        readonly executed: boolean;
                        readonly metadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: JsonValue;
                            };
                        };
                        readonly resultMetadata?: {
                            readonly [x: string]: {
                                readonly [x: string]: JsonValue;
                            };
                        };
                    };
                    readonly state: {
                        readonly status: "pending";
                        readonly input: string;
                    } | {
                        readonly status: "running";
                        readonly input: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly structured: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly content: ReadonlyArray<{
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string;
                                readonly name?: string;
                                readonly description?: string;
                                readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                                readonly annotations?: {
                                    readonly [x: string]: JsonValue;
                                };
                                readonly meta?: {
                                    readonly [x: string]: JsonValue;
                                };
                            };
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string;
                                readonly name?: string;
                                readonly description?: string;
                                readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                                readonly annotations?: {
                                    readonly [x: string]: JsonValue;
                                };
                                readonly meta?: {
                                    readonly [x: string]: JsonValue;
                                };
                            };
                        }>;
                    } | {
                        readonly status: "completed";
                        readonly input: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly attachments?: ReadonlyArray<{
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly source?: {
                                readonly start: number;
                                readonly end: number;
                                readonly text: string;
                            };
                            readonly resource?: {
                                readonly clientName: string;
                                readonly uri: string;
                            };
                            readonly materialized?: ReadonlyArray<{
                                readonly type: "text";
                                readonly text: string;
                            } | {
                                readonly type: "file";
                                readonly uri: string;
                                readonly mime: string;
                                readonly name?: string;
                            } | {
                                readonly type: "error";
                                readonly message: string;
                            }>;
                        }>;
                        readonly content: ReadonlyArray<{
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string;
                                readonly name?: string;
                                readonly description?: string;
                                readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                                readonly annotations?: {
                                    readonly [x: string]: JsonValue;
                                };
                                readonly meta?: {
                                    readonly [x: string]: JsonValue;
                                };
                            };
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string;
                                readonly name?: string;
                                readonly description?: string;
                                readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                                readonly annotations?: {
                                    readonly [x: string]: JsonValue;
                                };
                                readonly meta?: {
                                    readonly [x: string]: JsonValue;
                                };
                            };
                        }>;
                        readonly outputPaths?: ReadonlyArray<string>;
                        readonly structured: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly result?: JsonValue;
                    } | {
                        readonly status: "error";
                        readonly input: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly content: ReadonlyArray<{
                            readonly type: "text";
                            readonly text: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string;
                                readonly name?: string;
                                readonly description?: string;
                                readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                                readonly annotations?: {
                                    readonly [x: string]: JsonValue;
                                };
                                readonly meta?: {
                                    readonly [x: string]: JsonValue;
                                };
                            };
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string;
                            readonly provenance?: {
                                readonly type: "mcp";
                                readonly clientName: string;
                                readonly uri: string;
                                readonly kind: "resource" | "resource_link";
                                readonly mime?: string;
                                readonly name?: string;
                                readonly description?: string;
                                readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                                readonly annotations?: {
                                    readonly [x: string]: JsonValue;
                                };
                                readonly meta?: {
                                    readonly [x: string]: JsonValue;
                                };
                            };
                        }>;
                        readonly structured: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly error: {
                            readonly type: "unknown";
                            readonly message: string;
                        };
                        readonly result?: JsonValue;
                    };
                    readonly time: {
                        readonly created: number;
                        readonly ran?: number;
                        readonly completed?: number;
                        readonly pruned?: number;
                    };
                }>;
                readonly snapshot?: {
                    readonly start?: string;
                    readonly end?: string;
                    readonly files?: ReadonlyArray<string>;
                    readonly patch?: ReadonlyArray<{
                        readonly path: string;
                        readonly status: "added" | "modified" | "deleted";
                        readonly additions: number;
                        readonly deletions: number;
                        readonly patch: string;
                    }>;
                };
                readonly finish?: string;
                readonly structured?: JsonValue;
                readonly cost?: number;
                readonly tokens?: {
                    readonly input: number;
                    readonly output: number;
                    readonly reasoning: number;
                    readonly cache: {
                        readonly read: number;
                        readonly write: number;
                    };
                };
                readonly error?: {
                    readonly type: "unknown";
                    readonly message: string;
                };
            } | {
                readonly type: "compaction";
                readonly reason: "auto" | "manual";
                readonly summary: string;
                readonly recent: string;
                readonly id: string;
                readonly metadata?: {
                    readonly [x: string]: JsonValue;
                };
                readonly time: {
                    readonly created: number;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.prompted";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: ReadonlyArray<{
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: JsonValue;
                    };
                }>;
                readonly files?: ReadonlyArray<{
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    };
                    readonly materialized?: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    }>;
                }>;
                readonly agents?: ReadonlyArray<{
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly guidance?: string;
                }>;
                readonly system?: string;
                readonly tools?: {
                    readonly [x: string]: boolean;
                };
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly retryCount?: number;
                };
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "turn" | "session";
            };
            readonly delivery: "steer" | "queue";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string;
            } | {
                readonly type: "queue";
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.prompt.admitted";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly prompt: {
                readonly text: string;
                readonly context?: ReadonlyArray<{
                    readonly text: string;
                    readonly metadata?: {
                        readonly [x: string]: JsonValue;
                    };
                }>;
                readonly files?: ReadonlyArray<{
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    };
                    readonly materialized?: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    }>;
                }>;
                readonly agents?: ReadonlyArray<{
                    readonly name: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly guidance?: string;
                }>;
                readonly system?: string;
                readonly tools?: {
                    readonly [x: string]: boolean;
                };
                readonly format?: {
                    readonly type: "text";
                } | {
                    readonly type: "json_schema";
                    readonly schema: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly retryCount?: number;
                };
            };
            readonly synthetic?: {
                readonly description: string;
                readonly scope?: "turn" | "session";
            };
            readonly delivery: "steer" | "queue";
            readonly intent?: {
                readonly type: "start";
            } | {
                readonly type: "steer";
                readonly expectedTurnID: string;
            } | {
                readonly type: "queue";
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.turn.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly turnID: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.turn.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly turnID: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.context.updated";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly text: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.synthetic";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly text: string;
            readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.shell.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly userID?: string;
            readonly callID: string;
            readonly command: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.shell.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly callID: string;
            readonly output: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.step.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly agent: string;
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
            readonly snapshot?: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.step.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
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
            readonly snapshot?: string;
            readonly files?: ReadonlyArray<string>;
            readonly patch?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.step.failed";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
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
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.text.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly textID: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.text.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
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
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.tool.input.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
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
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.tool.input.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
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
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.tool.called";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly callID: string;
            readonly tool: string;
            readonly input: {
                readonly [x: string]: JsonValue;
            };
            readonly provider: {
                readonly executed: boolean;
                readonly metadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.tool.progress";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly callID: string;
            readonly structured: {
                readonly [x: string]: JsonValue;
            };
            readonly content: ReadonlyArray<{
                readonly type: "text";
                readonly text: string;
                readonly provenance?: {
                    readonly type: "mcp";
                    readonly clientName: string;
                    readonly uri: string;
                    readonly kind: "resource" | "resource_link";
                    readonly mime?: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                    readonly annotations?: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly meta?: {
                        readonly [x: string]: JsonValue;
                    };
                };
            } | {
                readonly type: "file";
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly provenance?: {
                    readonly type: "mcp";
                    readonly clientName: string;
                    readonly uri: string;
                    readonly kind: "resource" | "resource_link";
                    readonly mime?: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                    readonly annotations?: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly meta?: {
                        readonly [x: string]: JsonValue;
                    };
                };
            }>;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.tool.success";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly callID: string;
            readonly structured: {
                readonly [x: string]: JsonValue;
            };
            readonly content: ReadonlyArray<{
                readonly type: "text";
                readonly text: string;
                readonly provenance?: {
                    readonly type: "mcp";
                    readonly clientName: string;
                    readonly uri: string;
                    readonly kind: "resource" | "resource_link";
                    readonly mime?: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                    readonly annotations?: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly meta?: {
                        readonly [x: string]: JsonValue;
                    };
                };
            } | {
                readonly type: "file";
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly provenance?: {
                    readonly type: "mcp";
                    readonly clientName: string;
                    readonly uri: string;
                    readonly kind: "resource" | "resource_link";
                    readonly mime?: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                    readonly annotations?: {
                        readonly [x: string]: JsonValue;
                    };
                    readonly meta?: {
                        readonly [x: string]: JsonValue;
                    };
                };
            }>;
            readonly outputPaths?: ReadonlyArray<string>;
            readonly result?: JsonValue;
            readonly provider: {
                readonly executed: boolean;
                readonly metadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.tool.failed";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly callID: string;
            readonly error: {
                readonly type: "unknown";
                readonly message: string;
            };
            readonly result?: JsonValue;
            readonly provider: {
                readonly executed: boolean;
                readonly metadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.reasoning.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly reasoningID: string;
            readonly providerMetadata?: {
                readonly [x: string]: {
                    readonly [x: string]: JsonValue;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.reasoning.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly assistantMessageID: string;
            readonly reasoningID: string;
            readonly text: string;
            readonly providerMetadata?: {
                readonly [x: string]: {
                    readonly [x: string]: JsonValue;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.provider.attempt.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly attemptID: string;
            readonly assistantMessageID: string;
            readonly attempt: number;
            readonly retryOf?: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.provider.attempt.response.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly attemptID: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.provider.attempt.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly attemptID: string;
            readonly assistantMessageID: string;
            readonly outcome: "completed" | "failed" | "interrupted" | "abandoned";
            readonly continuation: boolean;
            readonly error?: {
                readonly type: "unknown";
                readonly message: string;
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.provider.recovery.decided";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly attemptID: string;
            readonly decision: "retry" | "abandon";
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.retried";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly attemptID: string;
            readonly attempt: number;
            readonly next: number;
            readonly error: {
                readonly message: string;
                readonly statusCode?: number;
                readonly isRetryable: boolean;
                readonly responseHeaders?: {
                    readonly [x: string]: string;
                };
                readonly responseBody?: string;
                readonly metadata?: {
                    readonly [x: string]: string;
                };
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.compaction.started";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly reason: "auto" | "manual";
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.compaction.ended";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
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
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.compaction.failed";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
            readonly reason: "auto" | "manual";
            readonly error: {
                readonly type: "unknown";
                readonly message: string;
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.revert.staged";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly revert: {
                readonly messageID: string;
                readonly partID?: string;
                readonly snapshot?: string;
                readonly diff?: string;
                readonly files?: ReadonlyArray<{
                    readonly path: string;
                    readonly status: "added" | "modified" | "deleted";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }>;
            };
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.revert.cleared";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly type: "session.next.revert.committed";
        readonly durable?: {
            readonly aggregateID: string;
            readonly seq: number;
            readonly version: number;
        };
        readonly location?: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly data: {
            readonly timestamp: number;
            readonly sessionID: string;
            readonly messageID: string;
        };
    }>;
    readonly hasMore: boolean;
};
export type SessionsEventsInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly after?: {
        readonly after?: number | undefined;
    }["after"];
};
export type SessionsEventsOutput = {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.created";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly info: {
            readonly id: string;
            readonly parentID?: string;
            readonly projectID: string;
            readonly slug: string;
            readonly version: string;
            readonly agent?: string;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
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
                readonly compacting?: number;
                readonly archived?: number;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: JsonValue;
            };
            readonly share?: {
                readonly url: string;
            };
            readonly permission?: ReadonlyArray<{
                readonly action: string;
                readonly resource: string;
                readonly effect: "allow" | "deny" | "ask";
            }>;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string;
            };
            readonly subpath?: string;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string;
                readonly snapshot?: string;
                readonly diff?: string;
                readonly files?: ReadonlyArray<{
                    readonly path: string;
                    readonly status: "added" | "modified" | "deleted";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }>;
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.updated";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly info: {
            readonly id: string;
            readonly parentID?: string;
            readonly projectID: string;
            readonly slug: string;
            readonly version: string;
            readonly agent?: string;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
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
                readonly compacting?: number;
                readonly archived?: number;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: JsonValue;
            };
            readonly share?: {
                readonly url: string;
            };
            readonly permission?: ReadonlyArray<{
                readonly action: string;
                readonly resource: string;
                readonly effect: "allow" | "deny" | "ask";
            }>;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string;
            };
            readonly subpath?: string;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string;
                readonly snapshot?: string;
                readonly diff?: string;
                readonly files?: ReadonlyArray<{
                    readonly path: string;
                    readonly status: "added" | "modified" | "deleted";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }>;
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.deleted";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly info: {
            readonly id: string;
            readonly parentID?: string;
            readonly projectID: string;
            readonly slug: string;
            readonly version: string;
            readonly agent?: string;
            readonly model?: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
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
                readonly compacting?: number;
                readonly archived?: number;
            };
            readonly title: string;
            readonly metadata?: {
                readonly [x: string]: JsonValue;
            };
            readonly share?: {
                readonly url: string;
            };
            readonly permission?: ReadonlyArray<{
                readonly action: string;
                readonly resource: string;
                readonly effect: "allow" | "deny" | "ask";
            }>;
            readonly location: {
                readonly directory: string;
                readonly workspaceID?: string;
            };
            readonly subpath?: string;
            readonly revert?: {
                readonly messageID: string;
                readonly partID?: string;
                readonly snapshot?: string;
                readonly diff?: string;
                readonly files?: ReadonlyArray<{
                    readonly path: string;
                    readonly status: "added" | "modified" | "deleted";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }>;
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.status";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
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
                readonly link?: string;
            };
            readonly next: number;
        } | {
            readonly type: "busy";
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.agent.switched";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.model.switched";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.moved";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly location: {
            readonly directory: string;
            readonly workspaceID?: string;
        };
        readonly subdirectory?: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.message.imported";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly message: {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
            };
            readonly type: "agent-switched";
            readonly agent: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
            };
            readonly type: "model-switched";
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
            };
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: unknown;
                };
                readonly retryCount?: number;
            };
            readonly type: "user";
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
            };
            readonly sessionID: string;
            readonly text: string;
            readonly description?: string;
            readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
            readonly type: "synthetic";
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
            };
            readonly type: "system";
            readonly text: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
                readonly completed?: number;
            };
            readonly type: "shell";
            readonly userID?: string;
            readonly callID: string;
            readonly command: string;
            readonly output: string;
        } | {
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
                readonly completed?: number;
            };
            readonly type: "assistant";
            readonly agent: string;
            readonly model: {
                readonly id: string;
                readonly providerID: string;
                readonly variant?: string;
                readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
            };
            readonly content: ReadonlyArray<{
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
                };
                readonly time?: {
                    readonly created: number;
                    readonly completed?: number;
                };
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
                    };
                    readonly resultMetadata?: {
                        readonly [x: string]: {
                            readonly [x: string]: unknown;
                        };
                    };
                };
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
                    readonly content: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly size?: number;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            };
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            };
                        };
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly size?: number;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            };
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            };
                        };
                    }>;
                } | {
                    readonly status: "completed";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly attachments?: ReadonlyArray<{
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly source?: {
                            readonly start: number;
                            readonly end: number;
                            readonly text: string;
                        };
                        readonly resource?: {
                            readonly clientName: string;
                            readonly uri: string;
                        };
                        readonly materialized?: ReadonlyArray<{
                            readonly type: "text";
                            readonly text: string;
                        } | {
                            readonly type: "file";
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: string;
                        } | {
                            readonly type: "error";
                            readonly message: string;
                        }>;
                    }>;
                    readonly content: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly size?: number;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            };
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            };
                        };
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly size?: number;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            };
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            };
                        };
                    }>;
                    readonly outputPaths?: ReadonlyArray<string>;
                    readonly structured: {
                        readonly [x: string]: unknown;
                    };
                    readonly result?: unknown;
                } | {
                    readonly status: "error";
                    readonly input: {
                        readonly [x: string]: unknown;
                    };
                    readonly content: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly size?: number;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            };
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            };
                        };
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                        readonly provenance?: {
                            readonly type: "mcp";
                            readonly clientName: string;
                            readonly uri: string;
                            readonly kind: "resource" | "resource_link";
                            readonly mime?: string;
                            readonly name?: string;
                            readonly description?: string;
                            readonly size?: number;
                            readonly annotations?: {
                                readonly [x: string]: unknown;
                            };
                            readonly meta?: {
                                readonly [x: string]: unknown;
                            };
                        };
                    }>;
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
                    readonly ran?: number;
                    readonly completed?: number;
                    readonly pruned?: number;
                };
            }>;
            readonly snapshot?: {
                readonly start?: string;
                readonly end?: string;
                readonly files?: ReadonlyArray<string>;
                readonly patch?: ReadonlyArray<{
                    readonly path: string;
                    readonly status: "added" | "modified" | "deleted";
                    readonly additions: number;
                    readonly deletions: number;
                    readonly patch: string;
                }>;
            };
            readonly finish?: string;
            readonly structured?: unknown;
            readonly cost?: number;
            readonly tokens?: {
                readonly input: number;
                readonly output: number;
                readonly reasoning: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            };
            readonly error?: {
                readonly type: "unknown";
                readonly message: string;
            };
        } | {
            readonly type: "compaction";
            readonly reason: "auto" | "manual";
            readonly summary: string;
            readonly recent: string;
            readonly id: string;
            readonly metadata?: {
                readonly [x: string]: unknown;
            };
            readonly time: {
                readonly created: number;
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.prompted";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: unknown;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.prompt.admitted";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
        readonly prompt: {
            readonly text: string;
            readonly context?: ReadonlyArray<{
                readonly text: string;
                readonly metadata?: {
                    readonly [x: string]: unknown;
                };
            }>;
            readonly files?: ReadonlyArray<{
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
                readonly description?: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly resource?: {
                    readonly clientName: string;
                    readonly uri: string;
                };
                readonly materialized?: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                } | {
                    readonly type: "error";
                    readonly message: string;
                }>;
            }>;
            readonly agents?: ReadonlyArray<{
                readonly name: string;
                readonly source?: {
                    readonly start: number;
                    readonly end: number;
                    readonly text: string;
                };
                readonly guidance?: string;
            }>;
            readonly system?: string;
            readonly tools?: {
                readonly [x: string]: boolean;
            };
            readonly format?: {
                readonly type: "text";
            } | {
                readonly type: "json_schema";
                readonly schema: {
                    readonly [x: string]: unknown;
                };
                readonly retryCount?: number;
            };
        };
        readonly synthetic?: {
            readonly description: string;
            readonly scope?: "turn" | "session";
        };
        readonly delivery: "steer" | "queue";
        readonly intent?: {
            readonly type: "start";
        } | {
            readonly type: "steer";
            readonly expectedTurnID: string;
        } | {
            readonly type: "queue";
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.turn.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly turnID: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.turn.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly turnID: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.context.updated";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.synthetic";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
        readonly text: string;
        readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.shell.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
        readonly userID?: string;
        readonly callID: string;
        readonly command: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.shell.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.step.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly assistantMessageID: string;
        readonly agent: string;
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
        readonly snapshot?: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.step.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
        readonly snapshot?: string;
        readonly files?: ReadonlyArray<string>;
        readonly patch?: ReadonlyArray<{
            readonly path: string;
            readonly status: "added" | "modified" | "deleted";
            readonly additions: number;
            readonly deletions: number;
            readonly patch: string;
        }>;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.step.failed";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.text.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.text.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.tool.input.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.tool.input.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.tool.called";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.tool.progress";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly assistantMessageID: string;
        readonly callID: string;
        readonly structured: {
            readonly [x: string]: unknown;
        };
        readonly content: ReadonlyArray<{
            readonly type: "text";
            readonly text: string;
            readonly provenance?: {
                readonly type: "mcp";
                readonly clientName: string;
                readonly uri: string;
                readonly kind: "resource" | "resource_link";
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly size?: number;
                readonly annotations?: {
                    readonly [x: string]: unknown;
                };
                readonly meta?: {
                    readonly [x: string]: unknown;
                };
            };
        } | {
            readonly type: "file";
            readonly uri: string;
            readonly mime: string;
            readonly name?: string;
            readonly provenance?: {
                readonly type: "mcp";
                readonly clientName: string;
                readonly uri: string;
                readonly kind: "resource" | "resource_link";
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly size?: number;
                readonly annotations?: {
                    readonly [x: string]: unknown;
                };
                readonly meta?: {
                    readonly [x: string]: unknown;
                };
            };
        }>;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.tool.success";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly assistantMessageID: string;
        readonly callID: string;
        readonly structured: {
            readonly [x: string]: unknown;
        };
        readonly content: ReadonlyArray<{
            readonly type: "text";
            readonly text: string;
            readonly provenance?: {
                readonly type: "mcp";
                readonly clientName: string;
                readonly uri: string;
                readonly kind: "resource" | "resource_link";
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly size?: number;
                readonly annotations?: {
                    readonly [x: string]: unknown;
                };
                readonly meta?: {
                    readonly [x: string]: unknown;
                };
            };
        } | {
            readonly type: "file";
            readonly uri: string;
            readonly mime: string;
            readonly name?: string;
            readonly provenance?: {
                readonly type: "mcp";
                readonly clientName: string;
                readonly uri: string;
                readonly kind: "resource" | "resource_link";
                readonly mime?: string;
                readonly name?: string;
                readonly description?: string;
                readonly size?: number;
                readonly annotations?: {
                    readonly [x: string]: unknown;
                };
                readonly meta?: {
                    readonly [x: string]: unknown;
                };
            };
        }>;
        readonly outputPaths?: ReadonlyArray<string>;
        readonly result?: unknown;
        readonly provider: {
            readonly executed: boolean;
            readonly metadata?: {
                readonly [x: string]: {
                    readonly [x: string]: unknown;
                };
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.tool.failed";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.reasoning.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly assistantMessageID: string;
        readonly reasoningID: string;
        readonly providerMetadata?: {
            readonly [x: string]: {
                readonly [x: string]: unknown;
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.reasoning.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.provider.attempt.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly attemptID: string;
        readonly assistantMessageID: string;
        readonly attempt: number;
        readonly retryOf?: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.provider.attempt.response.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly attemptID: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.provider.attempt.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly attemptID: string;
        readonly assistantMessageID: string;
        readonly outcome: "completed" | "failed" | "interrupted" | "abandoned";
        readonly continuation: boolean;
        readonly error?: {
            readonly type: "unknown";
            readonly message: string;
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.provider.recovery.decided";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly attemptID: string;
        readonly decision: "retry" | "abandon";
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.retried";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly attemptID: string;
        readonly attempt: number;
        readonly next: number;
        readonly error: {
            readonly message: string;
            readonly statusCode?: number;
            readonly isRetryable: boolean;
            readonly responseHeaders?: {
                readonly [x: string]: string;
            };
            readonly responseBody?: string;
            readonly metadata?: {
                readonly [x: string]: string;
            };
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.compaction.started";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.compaction.ended";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
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
    };
    readonly type: "session.next.compaction.failed";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
        readonly reason: "auto" | "manual";
        readonly error: {
            readonly type: "unknown";
            readonly message: string;
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.revert.staged";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly revert: {
            readonly messageID: string;
            readonly partID?: string;
            readonly snapshot?: string;
            readonly diff?: string;
            readonly files?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.revert.cleared";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
    };
} | {
    readonly id: string;
    readonly metadata?: {
        readonly [x: string]: unknown;
    };
    readonly type: "session.next.revert.committed";
    readonly durable?: {
        readonly aggregateID: string;
        readonly seq: number;
        readonly version: number;
    };
    readonly location?: {
        readonly directory: string;
        readonly workspaceID?: string;
    };
    readonly data: {
        readonly timestamp: number;
        readonly sessionID: string;
        readonly messageID: string;
    };
};
export type SessionsInterruptInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type SessionsInterruptOutput = void;
export type SessionsMessageInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly messageID: string;
    }["sessionID"];
    readonly messageID: {
        readonly sessionID: string;
        readonly messageID: string;
    }["messageID"];
};
export type SessionsMessageOutput = {
    readonly data: {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "agent-switched";
        readonly agent: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "model-switched";
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly text: string;
        readonly context?: ReadonlyArray<{
            readonly text: string;
            readonly metadata?: {
                readonly [x: string]: JsonValue;
            };
        }>;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
            readonly materialized?: ReadonlyArray<{
                readonly type: "text";
                readonly text: string;
            } | {
                readonly type: "file";
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
            } | {
                readonly type: "error";
                readonly message: string;
            }>;
        }>;
        readonly agents?: ReadonlyArray<{
            readonly name: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly guidance?: string;
        }>;
        readonly system?: string;
        readonly tools?: {
            readonly [x: string]: boolean;
        };
        readonly format?: {
            readonly type: "text";
        } | {
            readonly type: "json_schema";
            readonly schema: {
                readonly [x: string]: JsonValue;
            };
            readonly retryCount?: number;
        };
        readonly type: "user";
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly sessionID: string;
        readonly text: string;
        readonly description?: string;
        readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
        readonly type: "synthetic";
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "system";
        readonly text: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
            readonly completed?: number;
        };
        readonly type: "shell";
        readonly userID?: string;
        readonly callID: string;
        readonly command: string;
        readonly output: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
            readonly completed?: number;
        };
        readonly type: "assistant";
        readonly agent: string;
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
        readonly content: ReadonlyArray<{
            readonly type: "text";
            readonly id: string;
            readonly text: string;
        } | {
            readonly type: "reasoning";
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?: {
                readonly [x: string]: {
                    readonly [x: string]: JsonValue;
                };
            };
            readonly time?: {
                readonly created: number;
                readonly completed?: number;
            };
        } | {
            readonly type: "tool";
            readonly id: string;
            readonly name: string;
            readonly provider?: {
                readonly executed: boolean;
                readonly metadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
                readonly resultMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
            readonly state: {
                readonly status: "pending";
                readonly input: string;
            } | {
                readonly status: "running";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
            } | {
                readonly status: "completed";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly attachments?: ReadonlyArray<{
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    };
                    readonly materialized?: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    }>;
                }>;
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
                readonly outputPaths?: ReadonlyArray<string>;
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly result?: JsonValue;
            } | {
                readonly status: "error";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
                readonly result?: JsonValue;
            };
            readonly time: {
                readonly created: number;
                readonly ran?: number;
                readonly completed?: number;
                readonly pruned?: number;
            };
        }>;
        readonly snapshot?: {
            readonly start?: string;
            readonly end?: string;
            readonly files?: ReadonlyArray<string>;
            readonly patch?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
        readonly finish?: string;
        readonly structured?: JsonValue;
        readonly cost?: number;
        readonly tokens?: {
            readonly input: number;
            readonly output: number;
            readonly reasoning: number;
            readonly cache: {
                readonly read: number;
                readonly write: number;
            };
        };
        readonly error?: {
            readonly type: "unknown";
            readonly message: string;
        };
    } | {
        readonly type: "compaction";
        readonly reason: "auto" | "manual";
        readonly summary: string;
        readonly recent: string;
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
    };
}["data"];
export type MessagesListInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly limit?: {
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly cursor?: string | undefined;
    }["limit"];
    readonly order?: {
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly cursor?: string | undefined;
    }["order"];
    readonly cursor?: {
        readonly limit?: number | undefined;
        readonly order?: "asc" | "desc" | undefined;
        readonly cursor?: string | undefined;
    }["cursor"];
};
export type MessagesListOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "agent-switched";
        readonly agent: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "model-switched";
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly text: string;
        readonly context?: ReadonlyArray<{
            readonly text: string;
            readonly metadata?: {
                readonly [x: string]: JsonValue;
            };
        }>;
        readonly files?: ReadonlyArray<{
            readonly uri: string;
            readonly mime: string;
            readonly name?: string;
            readonly description?: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly resource?: {
                readonly clientName: string;
                readonly uri: string;
            };
            readonly materialized?: ReadonlyArray<{
                readonly type: "text";
                readonly text: string;
            } | {
                readonly type: "file";
                readonly uri: string;
                readonly mime: string;
                readonly name?: string;
            } | {
                readonly type: "error";
                readonly message: string;
            }>;
        }>;
        readonly agents?: ReadonlyArray<{
            readonly name: string;
            readonly source?: {
                readonly start: number;
                readonly end: number;
                readonly text: string;
            };
            readonly guidance?: string;
        }>;
        readonly system?: string;
        readonly tools?: {
            readonly [x: string]: boolean;
        };
        readonly format?: {
            readonly type: "text";
        } | {
            readonly type: "json_schema";
            readonly schema: {
                readonly [x: string]: JsonValue;
            };
            readonly retryCount?: number;
        };
        readonly type: "user";
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly sessionID: string;
        readonly text: string;
        readonly description?: string;
        readonly kind?: "plan-mode" | "plan-approved" | "build-switch";
        readonly type: "synthetic";
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
        readonly type: "system";
        readonly text: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
            readonly completed?: number;
        };
        readonly type: "shell";
        readonly userID?: string;
        readonly callID: string;
        readonly command: string;
        readonly output: string;
    } | {
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
            readonly completed?: number;
        };
        readonly type: "assistant";
        readonly agent: string;
        readonly model: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
        readonly content: ReadonlyArray<{
            readonly type: "text";
            readonly id: string;
            readonly text: string;
        } | {
            readonly type: "reasoning";
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?: {
                readonly [x: string]: {
                    readonly [x: string]: JsonValue;
                };
            };
            readonly time?: {
                readonly created: number;
                readonly completed?: number;
            };
        } | {
            readonly type: "tool";
            readonly id: string;
            readonly name: string;
            readonly provider?: {
                readonly executed: boolean;
                readonly metadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
                readonly resultMetadata?: {
                    readonly [x: string]: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
            readonly state: {
                readonly status: "pending";
                readonly input: string;
            } | {
                readonly status: "running";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
            } | {
                readonly status: "completed";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly attachments?: ReadonlyArray<{
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly description?: string;
                    readonly source?: {
                        readonly start: number;
                        readonly end: number;
                        readonly text: string;
                    };
                    readonly resource?: {
                        readonly clientName: string;
                        readonly uri: string;
                    };
                    readonly materialized?: ReadonlyArray<{
                        readonly type: "text";
                        readonly text: string;
                    } | {
                        readonly type: "file";
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: string;
                    } | {
                        readonly type: "error";
                        readonly message: string;
                    }>;
                }>;
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
                readonly outputPaths?: ReadonlyArray<string>;
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly result?: JsonValue;
            } | {
                readonly status: "error";
                readonly input: {
                    readonly [x: string]: JsonValue;
                };
                readonly content: ReadonlyArray<{
                    readonly type: "text";
                    readonly text: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                } | {
                    readonly type: "file";
                    readonly uri: string;
                    readonly mime: string;
                    readonly name?: string;
                    readonly provenance?: {
                        readonly type: "mcp";
                        readonly clientName: string;
                        readonly uri: string;
                        readonly kind: "resource" | "resource_link";
                        readonly mime?: string;
                        readonly name?: string;
                        readonly description?: string;
                        readonly size?: number | "Infinity" | "-Infinity" | "NaN";
                        readonly annotations?: {
                            readonly [x: string]: JsonValue;
                        };
                        readonly meta?: {
                            readonly [x: string]: JsonValue;
                        };
                    };
                }>;
                readonly structured: {
                    readonly [x: string]: JsonValue;
                };
                readonly error: {
                    readonly type: "unknown";
                    readonly message: string;
                };
                readonly result?: JsonValue;
            };
            readonly time: {
                readonly created: number;
                readonly ran?: number;
                readonly completed?: number;
                readonly pruned?: number;
            };
        }>;
        readonly snapshot?: {
            readonly start?: string;
            readonly end?: string;
            readonly files?: ReadonlyArray<string>;
            readonly patch?: ReadonlyArray<{
                readonly path: string;
                readonly status: "added" | "modified" | "deleted";
                readonly additions: number;
                readonly deletions: number;
                readonly patch: string;
            }>;
        };
        readonly finish?: string;
        readonly structured?: JsonValue;
        readonly cost?: number;
        readonly tokens?: {
            readonly input: number;
            readonly output: number;
            readonly reasoning: number;
            readonly cache: {
                readonly read: number;
                readonly write: number;
            };
        };
        readonly error?: {
            readonly type: "unknown";
            readonly message: string;
        };
    } | {
        readonly type: "compaction";
        readonly reason: "auto" | "manual";
        readonly summary: string;
        readonly recent: string;
        readonly id: string;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly time: {
            readonly created: number;
        };
    }>;
    readonly cursor: {
        readonly previous?: string | null;
        readonly next?: string | null;
    };
    readonly watermark?: number | null;
};
export type ModelsListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ModelsListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly providerID: string;
        readonly family?: string;
        readonly name: string;
        readonly api: {
            readonly id: string;
            readonly type: "aisdk";
            readonly package: string;
            readonly url?: string;
            readonly settings?: {
                readonly [x: string]: JsonValue;
            };
        } | {
            readonly id: string;
            readonly type: "native";
            readonly url?: string;
            readonly settings: {
                readonly [x: string]: JsonValue;
            };
        };
        readonly capabilities: {
            readonly tools: boolean;
            readonly input: ReadonlyArray<string>;
            readonly output: ReadonlyArray<string>;
            readonly temperature?: boolean;
            readonly reasoning?: boolean;
            readonly attachment?: boolean;
            readonly interleaved?: boolean | {
                readonly field: "reasoning" | "reasoning_content" | "reasoning_details";
            };
        };
        readonly request: {
            readonly headers: {
                readonly [x: string]: string;
            };
            readonly body: {
                readonly [x: string]: JsonValue;
            };
            readonly variant?: string;
        };
        readonly variants: ReadonlyArray<{
            readonly id: string;
            readonly headers: {
                readonly [x: string]: string;
            };
            readonly body: {
                readonly [x: string]: JsonValue;
            };
        }>;
        readonly protocols?: ReadonlyArray<"openai-responses" | "openai-compatible" | "anthropic-messages">;
        readonly time: {
            readonly released: number;
        };
        readonly cost: ReadonlyArray<{
            readonly tier?: {
                readonly type: "context";
                readonly size: number;
            };
            readonly input: number;
            readonly output: number;
            readonly cache: {
                readonly read: number;
                readonly write: number;
            };
        }>;
        readonly status: "alpha" | "beta" | "deprecated" | "active";
        readonly enabled: boolean;
        readonly limit: {
            readonly context: number;
            readonly input?: number;
            readonly output: number;
        };
    }>;
};
export type ProvidersCatalogInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProvidersCatalogOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly providers: ReadonlyArray<{
            readonly info: {
                readonly id: string;
                readonly integrationID?: string;
                readonly name: string;
                readonly disabled?: boolean;
                readonly api: {
                    readonly type: "aisdk";
                    readonly package: string;
                    readonly url?: string;
                    readonly settings?: {
                        readonly [x: string]: JsonValue;
                    };
                } | {
                    readonly type: "native";
                    readonly url?: string;
                    readonly settings: {
                        readonly [x: string]: JsonValue;
                    };
                };
                readonly request: {
                    readonly headers: {
                        readonly [x: string]: string;
                    };
                    readonly body: {
                        readonly [x: string]: JsonValue;
                    };
                };
            };
            readonly source: "env" | "config" | "custom" | "api";
            readonly auth?: ("env" | "key" | "oauth") | null;
            readonly env: ReadonlyArray<string>;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly providerID: string;
            readonly family?: string;
            readonly name: string;
            readonly api: {
                readonly id: string;
                readonly type: "aisdk";
                readonly package: string;
                readonly url?: string;
                readonly settings?: {
                    readonly [x: string]: JsonValue;
                };
            } | {
                readonly id: string;
                readonly type: "native";
                readonly url?: string;
                readonly settings: {
                    readonly [x: string]: JsonValue;
                };
            };
            readonly capabilities: {
                readonly tools: boolean;
                readonly input: ReadonlyArray<string>;
                readonly output: ReadonlyArray<string>;
                readonly temperature?: boolean;
                readonly reasoning?: boolean;
                readonly attachment?: boolean;
                readonly interleaved?: boolean | {
                    readonly field: "reasoning" | "reasoning_content" | "reasoning_details";
                };
            };
            readonly request: {
                readonly headers: {
                    readonly [x: string]: string;
                };
                readonly body: {
                    readonly [x: string]: JsonValue;
                };
                readonly variant?: string;
            };
            readonly variants: ReadonlyArray<{
                readonly id: string;
                readonly headers: {
                    readonly [x: string]: string;
                };
                readonly body: {
                    readonly [x: string]: JsonValue;
                };
            }>;
            readonly protocols?: ReadonlyArray<"openai-responses" | "openai-compatible" | "anthropic-messages">;
            readonly time: {
                readonly released: number;
            };
            readonly cost: ReadonlyArray<{
                readonly tier?: {
                    readonly type: "context";
                    readonly size: number;
                };
                readonly input: number;
                readonly output: number;
                readonly cache: {
                    readonly read: number;
                    readonly write: number;
                };
            }>;
            readonly status: "alpha" | "beta" | "deprecated" | "active";
            readonly enabled: boolean;
            readonly limit: {
                readonly context: number;
                readonly input?: number;
                readonly output: number;
            };
        }>;
        readonly connected: ReadonlyArray<string>;
        readonly default: {
            readonly [x: string]: string;
        };
    };
};
export type ProvidersListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProvidersListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly integrationID?: string;
        readonly name: string;
        readonly disabled?: boolean;
        readonly api: {
            readonly type: "aisdk";
            readonly package: string;
            readonly url?: string;
            readonly settings?: {
                readonly [x: string]: JsonValue;
            };
        } | {
            readonly type: "native";
            readonly url?: string;
            readonly settings: {
                readonly [x: string]: JsonValue;
            };
        };
        readonly request: {
            readonly headers: {
                readonly [x: string]: string;
            };
            readonly body: {
                readonly [x: string]: JsonValue;
            };
        };
    }>;
};
export type ProvidersGetInput = {
    readonly providerID: {
        readonly providerID: string;
    }["providerID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProvidersGetOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly id: string;
        readonly integrationID?: string;
        readonly name: string;
        readonly disabled?: boolean;
        readonly api: {
            readonly type: "aisdk";
            readonly package: string;
            readonly url?: string;
            readonly settings?: {
                readonly [x: string]: JsonValue;
            };
        } | {
            readonly type: "native";
            readonly url?: string;
            readonly settings: {
                readonly [x: string]: JsonValue;
            };
        };
        readonly request: {
            readonly headers: {
                readonly [x: string]: string;
            };
            readonly body: {
                readonly [x: string]: JsonValue;
            };
        };
    };
};
export type ProvidersDiscoverModelsInput = {
    readonly providerID: {
        readonly providerID: string;
    }["providerID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProvidersDiscoverModelsOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly providerID: string;
        readonly source: "oauth" | "compatible" | "provider";
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name?: string;
            readonly context?: number;
            readonly input?: number;
            readonly output?: number;
        }>;
    };
};
export type ProvidersDisconnectInput = {
    readonly providerID: {
        readonly providerID: string;
    }["providerID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProvidersDisconnectOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: boolean;
};
export type ProvidersDiscoverCustomInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly protocol?: {
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
    }["protocol"];
    readonly baseURL: {
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
    }["baseURL"];
    readonly apiKey?: {
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
    }["apiKey"];
    readonly headers: {
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
    }["headers"];
};
export type ProvidersDiscoverCustomOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly endpoint: string;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name?: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    };
};
export type ProvidersConfigureCustomInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly providerID: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["providerID"];
    readonly name: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["name"];
    readonly protocol?: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["protocol"];
    readonly update?: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["update"];
    readonly baseURL: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["baseURL"];
    readonly apiKey?: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["apiKey"];
    readonly headers: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["headers"];
    readonly models: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly update?: boolean;
        readonly baseURL: string;
        readonly apiKey?: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
        readonly models: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly reasoning?: boolean;
            readonly context?: number;
            readonly output?: number;
        }>;
    }["models"];
};
export type ProvidersConfigureCustomOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly providerID: string;
        readonly name: string;
        readonly protocol: "openai-responses" | "openai-compatible" | "anthropic-messages";
        readonly models: ReadonlyArray<string>;
    };
};
export type ProvidersDisconnectCustomInput = {
    readonly providerID: {
        readonly providerID: string;
    }["providerID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProvidersDisconnectCustomOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: boolean;
};
export type IntegrationsListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type IntegrationsListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly methods: ReadonlyArray<{
            readonly id: string;
            readonly type: "oauth";
            readonly label: string;
            readonly prompts?: ReadonlyArray<{
                readonly type: "text";
                readonly key: string;
                readonly message: string;
                readonly placeholder?: string;
                readonly when?: {
                    readonly key: string;
                    readonly op: "eq" | "neq";
                    readonly value: string;
                };
            } | {
                readonly type: "select";
                readonly key: string;
                readonly message: string;
                readonly options: ReadonlyArray<{
                    readonly label: string;
                    readonly value: string;
                    readonly hint?: string;
                }>;
                readonly when?: {
                    readonly key: string;
                    readonly op: "eq" | "neq";
                    readonly value: string;
                };
            }>;
        } | {
            readonly type: "key";
            readonly label?: string;
        } | {
            readonly type: "env";
            readonly names: ReadonlyArray<string>;
        }>;
        readonly connections: ReadonlyArray<{
            readonly type: "credential";
            readonly id: string;
            readonly label: string;
        } | {
            readonly type: "env";
            readonly name: string;
        }>;
    }>;
};
export type IntegrationsGetInput = {
    readonly integrationID: {
        readonly integrationID: string;
    }["integrationID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type IntegrationsGetOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly id: string;
        readonly name: string;
        readonly methods: ReadonlyArray<{
            readonly id: string;
            readonly type: "oauth";
            readonly label: string;
            readonly prompts?: ReadonlyArray<{
                readonly type: "text";
                readonly key: string;
                readonly message: string;
                readonly placeholder?: string;
                readonly when?: {
                    readonly key: string;
                    readonly op: "eq" | "neq";
                    readonly value: string;
                };
            } | {
                readonly type: "select";
                readonly key: string;
                readonly message: string;
                readonly options: ReadonlyArray<{
                    readonly label: string;
                    readonly value: string;
                    readonly hint?: string;
                }>;
                readonly when?: {
                    readonly key: string;
                    readonly op: "eq" | "neq";
                    readonly value: string;
                };
            }>;
        } | {
            readonly type: "key";
            readonly label?: string;
        } | {
            readonly type: "env";
            readonly names: ReadonlyArray<string>;
        }>;
        readonly connections: ReadonlyArray<{
            readonly type: "credential";
            readonly id: string;
            readonly label: string;
        } | {
            readonly type: "env";
            readonly name: string;
        }>;
    } | null;
};
export type IntegrationsConnectKeyInput = {
    readonly integrationID: {
        readonly integrationID: string;
    }["integrationID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly key: {
        readonly key: string;
        readonly label?: string | undefined;
    }["key"];
    readonly label?: {
        readonly key: string;
        readonly label?: string | undefined;
    }["label"];
};
export type IntegrationsConnectKeyOutput = void;
export type IntegrationsConnectOauthInput = {
    readonly integrationID: {
        readonly integrationID: string;
    }["integrationID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly methodID: {
        readonly methodID: string;
        readonly inputs: {
            readonly [x: string]: string;
        };
        readonly label?: string | undefined;
    }["methodID"];
    readonly inputs: {
        readonly methodID: string;
        readonly inputs: {
            readonly [x: string]: string;
        };
        readonly label?: string | undefined;
    }["inputs"];
    readonly label?: {
        readonly methodID: string;
        readonly inputs: {
            readonly [x: string]: string;
        };
        readonly label?: string | undefined;
    }["label"];
};
export type IntegrationsConnectOauthOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly attemptID: string;
        readonly url: string;
        readonly instructions: string;
        readonly mode: "auto" | "code";
        readonly time: {
            readonly created: number | "Infinity" | "-Infinity" | "NaN";
            readonly expires: number | "Infinity" | "-Infinity" | "NaN";
        };
    };
};
export type IntegrationsAttemptStatusInput = {
    readonly attemptID: {
        readonly attemptID: string;
    }["attemptID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type IntegrationsAttemptStatusOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly status: "pending";
        readonly time: {
            readonly created: number | "Infinity" | "-Infinity" | "NaN";
            readonly expires: number | "Infinity" | "-Infinity" | "NaN";
        };
    } | {
        readonly status: "complete";
        readonly time: {
            readonly created: number | "Infinity" | "-Infinity" | "NaN";
            readonly expires: number | "Infinity" | "-Infinity" | "NaN";
        };
    } | {
        readonly status: "failed";
        readonly message: string;
        readonly time: {
            readonly created: number | "Infinity" | "-Infinity" | "NaN";
            readonly expires: number | "Infinity" | "-Infinity" | "NaN";
        };
    } | {
        readonly status: "expired";
        readonly time: {
            readonly created: number | "Infinity" | "-Infinity" | "NaN";
            readonly expires: number | "Infinity" | "-Infinity" | "NaN";
        };
    };
};
export type IntegrationsAttemptCompleteInput = {
    readonly attemptID: {
        readonly attemptID: string;
    }["attemptID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly code?: {
        readonly code?: string | undefined;
    }["code"];
};
export type IntegrationsAttemptCompleteOutput = void;
export type IntegrationsAttemptCancelInput = {
    readonly attemptID: {
        readonly attemptID: string;
    }["attemptID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type IntegrationsAttemptCancelOutput = void;
export type CredentialsUpdateInput = {
    readonly credentialID: {
        readonly credentialID: string;
    }["credentialID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly label: {
        readonly label: string;
    }["label"];
};
export type CredentialsUpdateOutput = void;
export type CredentialsRemoveInput = {
    readonly credentialID: {
        readonly credentialID: string;
    }["credentialID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type CredentialsRemoveOutput = void;
export type PermissionsListRequestsInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type PermissionsListRequestsOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly sessionID: string;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
    }>;
};
export type PermissionsListSavedInput = {
    readonly projectID?: {
        readonly projectID?: string | undefined;
    }["projectID"];
};
export type PermissionsListSavedOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly projectID: string;
        readonly action: string;
        readonly resource: string;
    }>;
}["data"];
export type PermissionsRemoveSavedInput = {
    readonly id: {
        readonly id: string;
    }["id"];
};
export type PermissionsRemoveSavedOutput = void;
export type PermissionsCreateInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly id?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["id"];
    readonly action: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["action"];
    readonly resources: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["resources"];
    readonly save?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["save"];
    readonly metadata?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["metadata"];
    readonly source?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["source"];
    readonly agent?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
        readonly agent?: string | null;
    }["agent"];
};
export type PermissionsCreateOutput = {
    readonly data: {
        readonly id: string;
        readonly effect: "allow" | "deny" | "ask";
    };
}["data"];
export type PermissionsListInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type PermissionsListOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly sessionID: string;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
    }>;
}["data"];
export type PermissionsGetInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["sessionID"];
    readonly requestID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["requestID"];
};
export type PermissionsGetOutput = {
    readonly data: {
        readonly id: string;
        readonly sessionID: string;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly callID: string;
        };
    };
}["data"];
export type PermissionsReplyInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["sessionID"];
    readonly requestID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["requestID"];
    readonly reply: {
        readonly reply: "once" | "always" | "reject";
        readonly message?: string | undefined;
    }["reply"];
    readonly message?: {
        readonly reply: "once" | "always" | "reject";
        readonly message?: string | undefined;
    }["message"];
};
export type PermissionsReplyOutput = void;
export type FilesReadInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly path: string;
    }["location"];
    readonly path: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly path: string;
    }["path"];
};
export type FilesReadOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly uri: string;
        readonly name?: string;
        readonly content: string;
        readonly encoding: "utf8" | "base64";
        readonly mime: string;
    };
};
export type FilesListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly path?: string | undefined;
    }["location"];
    readonly path?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly path?: string | undefined;
    }["path"];
};
export type FilesListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly path: string;
        readonly type: "file" | "directory";
    }>;
};
export type FilesFindInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly query: string;
        readonly type?: "file" | "directory" | undefined;
        readonly limit?: number | undefined;
    }["location"];
    readonly query: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly query: string;
        readonly type?: "file" | "directory" | undefined;
        readonly limit?: number | undefined;
    }["query"];
    readonly type?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly query: string;
        readonly type?: "file" | "directory" | undefined;
        readonly limit?: number | undefined;
    }["type"];
    readonly limit?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly query: string;
        readonly type?: "file" | "directory" | undefined;
        readonly limit?: number | undefined;
    }["limit"];
};
export type FilesFindOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly path: string;
        readonly type: "file" | "directory";
    }>;
};
export type CommandsListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type CommandsListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly name: string;
        readonly template: string;
        readonly description?: string;
        readonly agent?: string;
        readonly model?: {
            readonly id: string;
            readonly providerID: string;
            readonly variant?: string;
            readonly protocol?: "openai-responses" | "openai-compatible" | "anthropic-messages";
        };
        readonly subtask?: boolean;
    }>;
};
export type SkillsListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type SkillsListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly name: string;
        readonly description?: string;
        readonly slash?: boolean;
        readonly location: string;
        readonly content: string;
    }>;
};
export type McpsStatusInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type McpsStatusOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
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
};
export type McpsResourcesInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type McpsResourcesOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly [x: string]: {
            readonly name: string;
            readonly uri: string;
            readonly description?: string;
            readonly mimeType?: string;
            readonly client: string;
        };
    };
};
export type McpsConnectInput = {
    readonly name: {
        readonly name: string;
    }["name"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type McpsConnectOutput = void;
export type McpsDisconnectInput = {
    readonly name: {
        readonly name: string;
    }["name"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type McpsDisconnectOutput = void;
export type McpsAuthenticateInput = {
    readonly name: {
        readonly name: string;
    }["name"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type McpsAuthenticateOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
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
};
export type LspStatusInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type LspStatusOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly root: string;
        readonly status: "connected" | "error";
    }>;
};
export type ProjectsListOutput = ReadonlyArray<{
    readonly id: string;
    readonly worktree: string;
    readonly vcs?: "git";
    readonly name?: string;
    readonly icon?: {
        readonly url?: string;
        readonly override?: string;
        readonly color?: string;
    };
    readonly commands?: {
        readonly start?: string;
    };
    readonly time: {
        readonly created: number;
        readonly updated: number;
        readonly initialized?: number;
    };
    readonly sandboxes: ReadonlyArray<string>;
}>;
export type ProjectsInitGitInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProjectsInitGitOutput = {
    readonly id: string;
    readonly worktree: string;
    readonly vcs?: "git";
    readonly name?: string;
    readonly icon?: {
        readonly url?: string;
        readonly override?: string;
        readonly color?: string;
    };
    readonly commands?: {
        readonly start?: string;
    };
    readonly time: {
        readonly created: number;
        readonly updated: number;
        readonly initialized?: number;
    };
    readonly sandboxes: ReadonlyArray<string>;
};
export type ProjectsCurrentInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProjectsCurrentOutput = {
    readonly id: string;
    readonly directory: string;
};
export type ProjectsUpdateInput = {
    readonly projectID: {
        readonly projectID: string;
    }["projectID"];
    readonly name?: {
        readonly name?: string;
        readonly icon?: {
            readonly url?: string;
            readonly override?: string;
            readonly color?: string;
        };
        readonly commands?: {
            readonly start?: string;
        };
    }["name"];
    readonly icon?: {
        readonly name?: string;
        readonly icon?: {
            readonly url?: string;
            readonly override?: string;
            readonly color?: string;
        };
        readonly commands?: {
            readonly start?: string;
        };
    }["icon"];
    readonly commands?: {
        readonly name?: string;
        readonly icon?: {
            readonly url?: string;
            readonly override?: string;
            readonly color?: string;
        };
        readonly commands?: {
            readonly start?: string;
        };
    }["commands"];
};
export type ProjectsUpdateOutput = {
    readonly id: string;
    readonly worktree: string;
    readonly vcs?: "git";
    readonly name?: string;
    readonly icon?: {
        readonly url?: string;
        readonly override?: string;
        readonly color?: string;
    };
    readonly commands?: {
        readonly start?: string;
    };
    readonly time: {
        readonly created: number;
        readonly updated: number;
        readonly initialized?: number;
    };
    readonly sandboxes: ReadonlyArray<string>;
};
export type ProjectsDirectoriesInput = {
    readonly projectID: {
        readonly projectID: string;
    }["projectID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProjectsDirectoriesOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly directory: string;
        readonly strategy?: string;
    }>;
};
export type WorktreesCreateInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly name?: {
        readonly name?: string;
        readonly startCommand?: string;
    }["name"];
    readonly startCommand?: {
        readonly name?: string;
        readonly startCommand?: string;
    }["startCommand"];
};
export type WorktreesCreateOutput = {
    readonly name: string;
    readonly branch?: string;
    readonly directory: string;
};
export type WorktreesRemoveInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly directory: {
        readonly directory: string;
    }["directory"];
};
export type WorktreesRemoveOutput = boolean;
export type WorktreesResetInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly directory: {
        readonly directory: string;
    }["directory"];
};
export type WorktreesResetOutput = boolean;
export type CapabilitiesGetOutput = {
    readonly backgroundSubagents: boolean;
};
export type VcsGetInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type VcsGetOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly branch?: string;
        readonly default_branch?: string;
    };
};
export type VcsStatusInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type VcsStatusOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly file: string;
        readonly additions: number;
        readonly deletions: number;
        readonly status: "added" | "deleted" | "modified";
    }>;
};
export type VcsDiffInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly mode: "git" | "branch";
        readonly context?: number | undefined;
    }["location"];
    readonly mode: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly mode: "git" | "branch";
        readonly context?: number | undefined;
    }["mode"];
    readonly context?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
        readonly mode: "git" | "branch";
        readonly context?: number | undefined;
    }["context"];
};
export type VcsDiffOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly file?: string;
        readonly patch?: string;
        readonly additions: number;
        readonly deletions: number;
        readonly status?: "added" | "deleted" | "modified";
    }>;
};
export type FormattersStatusInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type FormattersStatusOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly name: string;
        readonly extensions: ReadonlyArray<string>;
        readonly enabled: boolean;
    }>;
};
export type ConsoleGetInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ConsoleGetOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly consoleManagedProviders: ReadonlyArray<string>;
        readonly activeOrgName?: string;
        readonly switchableOrgCount: number;
    };
};
export type ConsoleListOrgsInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ConsoleListOrgsOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly accountID: string;
        readonly accountEmail: string;
        readonly accountUrl: string;
        readonly orgID: string;
        readonly orgName: string;
        readonly active: boolean;
    }>;
};
export type ConsoleSwitchOrgInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly accountID: {
        readonly accountID: string;
        readonly orgID: string;
    }["accountID"];
    readonly orgID: {
        readonly accountID: string;
        readonly orgID: string;
    }["orgID"];
};
export type ConsoleSwitchOrgOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: boolean;
};
export type ConfigGetInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ConfigGetOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: JsonValue;
};
export type ConfigUpdateInput = {
    readonly config: {
        readonly config: JsonValue;
    }["config"];
};
export type ConfigUpdateOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: JsonValue;
};
export type WorkspacesListAdaptersInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type WorkspacesListAdaptersOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly type: string;
        readonly name: string;
        readonly description: string;
    }>;
};
export type WorkspacesListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type WorkspacesListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly type: string;
        readonly name: string;
        readonly branch?: string | null;
        readonly directory?: string | null;
        readonly extra?: JsonValue | null;
        readonly projectID: string;
        readonly timeUsed: number | "Infinity" | "-Infinity" | "NaN";
    }>;
};
export type WorkspacesCreateInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly id?: {
        readonly id?: string;
        readonly type: string;
        readonly branch?: string | null;
        readonly extra?: JsonValue | null;
    }["id"];
    readonly type: {
        readonly id?: string;
        readonly type: string;
        readonly branch?: string | null;
        readonly extra?: JsonValue | null;
    }["type"];
    readonly branch?: {
        readonly id?: string;
        readonly type: string;
        readonly branch?: string | null;
        readonly extra?: JsonValue | null;
    }["branch"];
    readonly extra?: {
        readonly id?: string;
        readonly type: string;
        readonly branch?: string | null;
        readonly extra?: JsonValue | null;
    }["extra"];
};
export type WorkspacesCreateOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly id: string;
        readonly type: string;
        readonly name: string;
        readonly branch?: string | null;
        readonly directory?: string | null;
        readonly extra?: JsonValue | null;
        readonly projectID: string;
        readonly timeUsed: number | "Infinity" | "-Infinity" | "NaN";
    };
};
export type WorkspacesRemoveInput = {
    readonly workspaceID: {
        readonly workspaceID: string;
    }["workspaceID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type WorkspacesRemoveOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: boolean;
};
export type WorkspacesStatusInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type WorkspacesStatusOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly workspaceID: string;
        readonly status: "connected" | "connecting" | "disconnected" | "error";
    }>;
};
export type WorkspacesSyncListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type WorkspacesSyncListOutput = void;
export type WorkspacesStartInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type WorkspacesStartOutput = void;
export type WorkspacesWarpInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly workspaceID: {
        readonly workspaceID: string | null;
        readonly sessionID: string;
        readonly copyChanges?: boolean;
    }["workspaceID"];
    readonly sessionID: {
        readonly workspaceID: string | null;
        readonly sessionID: string;
        readonly copyChanges?: boolean;
    }["sessionID"];
    readonly copyChanges?: {
        readonly workspaceID: string | null;
        readonly sessionID: string;
        readonly copyChanges?: boolean;
    }["copyChanges"];
};
export type WorkspacesWarpOutput = void;
export type ControlPlaneMoveSessionInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly destination: {
            readonly directory: string;
        };
        readonly moveChanges?: boolean;
    }["sessionID"];
    readonly destination: {
        readonly sessionID: string;
        readonly destination: {
            readonly directory: string;
        };
        readonly moveChanges?: boolean;
    }["destination"];
    readonly moveChanges?: {
        readonly sessionID: string;
        readonly destination: {
            readonly directory: string;
        };
        readonly moveChanges?: boolean;
    }["moveChanges"];
};
export type ControlPlaneMoveSessionOutput = void;
export type ServerPluginsListOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsAddInput = {
    readonly source: {
        readonly source: string;
    }["source"];
};
export type ServerPluginsAddOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsRefreshInput = {
    readonly name: {
        readonly name: string;
    }["name"];
};
export type ServerPluginsRefreshOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsRemoveInput = {
    readonly name: {
        readonly name: string;
    }["name"];
};
export type ServerPluginsRemoveOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsInstallInput = {
    readonly id: {
        readonly id: string;
    }["id"];
};
export type ServerPluginsInstallOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsUninstallInput = {
    readonly id: {
        readonly id: string;
    }["id"];
};
export type ServerPluginsUninstallOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsEnableInput = {
    readonly id: {
        readonly id: string;
    }["id"];
};
export type ServerPluginsEnableOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type ServerPluginsDisableInput = {
    readonly id: {
        readonly id: string;
    }["id"];
};
export type ServerPluginsDisableOutput = {
    readonly marketplaces: ReadonlyArray<{
        readonly name: string;
        readonly source: string;
        readonly lastUpdated: string;
        readonly pluginCount: number;
        readonly error?: string | undefined;
    }>;
    readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly marketplace: string;
        readonly description?: string | undefined;
        readonly version?: string | undefined;
        readonly category?: string | undefined;
        readonly tags: ReadonlyArray<string>;
        readonly capabilities: ReadonlyArray<string>;
        readonly mcpServers: ReadonlyArray<string>;
        readonly installed: boolean;
        readonly enabled: boolean;
    }>;
};
export type EventsSubscribeOutput = OpenCodeEventEncoded;
export type PtysShellsInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type PtysShellsOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly path: string;
        readonly name: string;
        readonly acceptable: boolean;
    }>;
};
export type PtysListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type PtysListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly title: string;
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly status: "running" | "exited";
        readonly pid: number;
        readonly exitCode?: number;
    }>;
};
export type PtysCreateInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly command?: {
        readonly command?: string;
        readonly args?: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly title?: string;
        readonly env?: {
            readonly [x: string]: string;
        };
    }["command"];
    readonly args?: {
        readonly command?: string;
        readonly args?: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly title?: string;
        readonly env?: {
            readonly [x: string]: string;
        };
    }["args"];
    readonly cwd?: {
        readonly command?: string;
        readonly args?: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly title?: string;
        readonly env?: {
            readonly [x: string]: string;
        };
    }["cwd"];
    readonly title?: {
        readonly command?: string;
        readonly args?: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly title?: string;
        readonly env?: {
            readonly [x: string]: string;
        };
    }["title"];
    readonly env?: {
        readonly command?: string;
        readonly args?: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly title?: string;
        readonly env?: {
            readonly [x: string]: string;
        };
    }["env"];
};
export type PtysCreateOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly id: string;
        readonly title: string;
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly status: "running" | "exited";
        readonly pid: number;
        readonly exitCode?: number;
    };
};
export type PtysGetInput = {
    readonly ptyID: {
        readonly ptyID: string;
    }["ptyID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type PtysGetOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly id: string;
        readonly title: string;
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly status: "running" | "exited";
        readonly pid: number;
        readonly exitCode?: number;
    };
};
export type PtysUpdateInput = {
    readonly ptyID: {
        readonly ptyID: string;
    }["ptyID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly title?: {
        readonly title?: string;
        readonly size?: {
            readonly rows: number;
            readonly cols: number;
        };
    }["title"];
    readonly size?: {
        readonly title?: string;
        readonly size?: {
            readonly rows: number;
            readonly cols: number;
        };
    }["size"];
};
export type PtysUpdateOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: {
        readonly id: string;
        readonly title: string;
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly status: "running" | "exited";
        readonly pid: number;
        readonly exitCode?: number;
    };
};
export type PtysRemoveInput = {
    readonly ptyID: {
        readonly ptyID: string;
    }["ptyID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type PtysRemoveOutput = void;
export type QuestionsListRequestsInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type QuestionsListRequestsOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly sessionID: string;
        readonly questions: ReadonlyArray<{
            readonly question: string;
            readonly header: string;
            readonly options: ReadonlyArray<{
                readonly label: string;
                readonly description: string;
            }>;
            readonly multiple?: boolean;
            readonly custom?: boolean;
        }>;
        readonly tool?: {
            readonly messageID: string;
            readonly callID: string;
        };
    }>;
};
export type QuestionsListInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
};
export type QuestionsListOutput = {
    readonly data: ReadonlyArray<{
        readonly id: string;
        readonly sessionID: string;
        readonly questions: ReadonlyArray<{
            readonly question: string;
            readonly header: string;
            readonly options: ReadonlyArray<{
                readonly label: string;
                readonly description: string;
            }>;
            readonly multiple?: boolean;
            readonly custom?: boolean;
        }>;
        readonly tool?: {
            readonly messageID: string;
            readonly callID: string;
        };
    }>;
}["data"];
export type QuestionsReplyInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["sessionID"];
    readonly requestID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["requestID"];
    readonly answers: {
        readonly answers: ReadonlyArray<ReadonlyArray<string>>;
    }["answers"];
};
export type QuestionsReplyOutput = void;
export type QuestionsRejectInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["sessionID"];
    readonly requestID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["requestID"];
};
export type QuestionsRejectOutput = void;
export type ReferencesListInput = {
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ReferencesListOutput = {
    readonly location: {
        readonly directory: string;
        readonly workspaceID?: string;
        readonly project: {
            readonly id: string;
            readonly directory: string;
        };
    };
    readonly data: ReadonlyArray<{
        readonly name: string;
        readonly path: string;
        readonly description?: string;
        readonly hidden?: boolean;
        readonly source: {
            readonly type: "local";
            readonly path: string;
            readonly description?: string;
            readonly hidden?: boolean;
        } | {
            readonly type: "git";
            readonly repository: string;
            readonly branch?: string;
            readonly description?: string;
            readonly hidden?: boolean;
        };
    }>;
};
export type ProjectCopiesGenerateNameInput = {
    readonly projectID: {
        readonly projectID: string;
    }["projectID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly context?: {
        readonly context?: string | undefined;
    }["context"];
};
export type ProjectCopiesGenerateNameOutput = {
    readonly name: string;
};
export type ProjectCopiesCreateInput = {
    readonly projectID: {
        readonly projectID: string;
    }["projectID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly strategy: {
        readonly strategy: string;
        readonly directory: string;
        readonly name?: string;
    }["strategy"];
    readonly directory: {
        readonly strategy: string;
        readonly directory: string;
        readonly name?: string;
    }["directory"];
    readonly name?: {
        readonly strategy: string;
        readonly directory: string;
        readonly name?: string;
    }["name"];
};
export type ProjectCopiesCreateOutput = {
    readonly directory: string;
};
export type ProjectCopiesRemoveInput = {
    readonly projectID: {
        readonly projectID: string;
    }["projectID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
    readonly directory: {
        readonly directory: string;
        readonly force: boolean;
    }["directory"];
    readonly force: {
        readonly directory: string;
        readonly force: boolean;
    }["force"];
};
export type ProjectCopiesRemoveOutput = void;
export type ProjectCopiesRefreshInput = {
    readonly projectID: {
        readonly projectID: string;
    }["projectID"];
    readonly location?: {
        readonly location?: {
            readonly directory?: string | undefined;
            readonly workspace?: string | undefined;
        } | undefined;
    }["location"];
};
export type ProjectCopiesRefreshOutput = void;
