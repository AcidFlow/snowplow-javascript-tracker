import {PayloadData, base64urldecode, isNonEmptyJson} from "./payload";
import {SelfDescribingJson} from "./core";
import isEqual = require('lodash/isequal');
import has = require('lodash/has');
import get = require('lodash/get');

/**
 * Datatypes (some algebraic) for representing context types
 */
export type ContextGenerator = (payload: SelfDescribingJson, eventType: string, schema: string) => SelfDescribingJson;
export type ContextPrimitive = SelfDescribingJson | ContextGenerator;
export type ContextFilter = (payload: SelfDescribingJson, eventType: string, schema: string) => boolean;
export type FilterContextProvider = [ContextFilter, ContextPrimitive];
export interface RuleSet {
    accept?: string[] | string;
    reject?: string[] | string;
}
export type PathContextProvider = [RuleSet, ContextPrimitive];
export type ConditionalContextProvider = FilterContextProvider | PathContextProvider;

function getSchemaParts(input: string): Array<string> | undefined {
    let re = new RegExp('^iglu:([a-zA-Z0-9-_.]+|\\.)\\/([a-zA-Z0-9-_]+|\\.)\\/([a-zA-Z0-9-_]+|\\.)\\/([0-9]+-[0-9]+-[0-9]|\\.)$');
    let matches = re.exec(input);
    if (matches !== null) {
        return matches.slice(1, 5);
    }
    return undefined;
}

function isValidMatcher(input: any): boolean {
    let schemaParts = getSchemaParts(input);
    if (schemaParts) {
        return schemaParts.length === 4;
    }
    return false;
}

function isStringArray(input: any): boolean {
    if (Array.isArray(input)) {
        return input.every(function(i){ return typeof i === 'string' });
    }
    return false;
}

function isValidRuleSetArg(input: any): boolean{
    if (isStringArray(input)) {
        input.every(function(i){ return isValidMatcher(i) });
    } else if (typeof input === 'string') {
        return isValidMatcher(input);
    }
    return false;
}

export function isSelfDescribingJson(input: any) : boolean {
    if (isNonEmptyJson(input)) {
        if ('schema' in input && 'data' in input) {
            return (typeof(input.schema) === 'string' && typeof(input.data) === 'object');
        }
    }
    return false;
}

function isObject(input: any) : boolean {
    return input && typeof input === 'object' && input.constructor === Object;
}

function isRuleSet(input: any) : boolean {
    let methodCount = 0;
    if (isObject(input)) {
        if (has(input, 'accept')) {
            if (isValidRuleSetArg(input['accept'])) {
                methodCount += 1;
            } else {
                return false;
            }
        }
        if (has(input, 'reject')) {
            if (isValidRuleSetArg(input['reject'])) {
                methodCount += 1;
            } else {
                return false;
            }
        }
        return methodCount > 0; // if 'reject' or 'accept' exists, we have a valid ruleset
    }
    return false;
}

function isContextGenerator(input: any) : boolean {
    if (typeof(input) === 'function') {
        return input.length === 1;
    }
    return false;
}

function isContextFilter(input: any) : boolean {
    if (typeof(input) === 'function') {
        return input.length === 1;
    }
    return false;
}

function isContextPrimitive(input: any) : boolean {
    return (isContextGenerator(input) || isSelfDescribingJson(input));
}

function isFilterContextProvider(input: any) : boolean {
    if (Array.isArray(input)) {
        if (input.length === 2) {
            return isContextFilter(input[0]) && isContextPrimitive(input[1]);
        }
    }
    return false;
}

function isPathContextProvider(input: any) : boolean {
    if (Array.isArray(input) && input.length === 2) {
        return isRuleSet(input[0]) && isContextPrimitive(input[1]);
    }
    return false;
}

function isConditionalContextProvider(input: any) : boolean {
    return isFilterContextProvider(input) || isPathContextProvider(input);
}

function matchSchemaAgainstRule(rule: string, schema: string) : boolean {
    let ruleParts = getSchemaParts(rule);
    let schemaParts = getSchemaParts(schema);
    if (ruleParts === undefined || schemaParts === undefined ||
        ruleParts.length !== 4 || schemaParts.length !== 4) {
        return false;
    }
    let matchCount = 0;
    for (let i = 0; i <= 3; i++) {
        if (ruleParts[0] === schemaParts[0] || ruleParts[0] === '.') {
            matchCount++;
        } else {
            return false;
        }
    }
    return matchCount === 4;
}

function matchSchemaAgainstRuleSet(ruleSet: RuleSet, schema: string) : boolean {
    let matchCount = 0;
    let acceptRules = get(ruleSet, 'accept');
    if (Array.isArray(acceptRules)) {
        if (!(ruleSet.accept as Array<string>).every((rule) => (matchSchemaAgainstRule(rule, schema)))) {
            return false;
        }
        matchCount++;
    } else if (typeof(acceptRules) === 'string') {
        if (!matchSchemaAgainstRule(acceptRules, schema)) {
            return false;
        }
        matchCount++;
    }

    let rejectRules = get(ruleSet, 'reject');
    if (Array.isArray(rejectRules)) {
        if (!(ruleSet.reject as Array<string>).every((rule) => (matchSchemaAgainstRule(rule, schema)))) {
            return false;
        }
        matchCount++;
    } else if (typeof(rejectRules) === 'string') {
        if (!matchSchemaAgainstRule(rejectRules, schema)) {
            return false;
        }
        matchCount++;
    }
    return matchCount > 0;
}

function getUsefulSchema(sb: SelfDescribingJson): string {
    if (typeof get(sb, 'e.ue_px.schema') === 'string') {
        return get(sb, 'e.ue_px.schema');
    } else if (typeof get(sb, 'e.ue_pr.schema') === 'string') {
        return get(sb, 'e.ue_pr.schema');
    } else if (typeof get(sb, 'schema') === 'string') {
        return get(sb, 'schema') as string;
    }jj
    return '';
}

function getDecodedEvent(sb: SelfDescribingJson): SelfDescribingJson {
    let decodedEvent = Object.assign({}, sb);
    if (has(decodedEvent, 'e.ue_px')) {
        decodedEvent['e']['ue_px'] = JSON.parse(base64urldecode(decodedEvent['ue_px']));
    }
    return decodedEvent;
}

function getEventType(sb: {}): string {
    return get(sb, 'e', '');
}

export function contextModule() {
    let globalPrimitives : Array<ContextPrimitive> = [];
    let conditionalProviders : Array<ConditionalContextProvider> = [];

    function generateContext(contextPrimitive: ContextPrimitive,
                             event: SelfDescribingJson,
                             eventType: string,
                             eventSchema: string) : SelfDescribingJson | undefined
    {
        if (isSelfDescribingJson(contextPrimitive)) {
            return <SelfDescribingJson> contextPrimitive;
        } else if (isContextGenerator(contextPrimitive)) {
            return (contextPrimitive as ContextGenerator)(event, eventType, eventSchema);
        }
    }

    function assembleAllContexts(event: SelfDescribingJson) : Array<SelfDescribingJson> {
        let eventSchema = getUsefulSchema(event);
        let eventType = getEventType(event);
        let contexts : Array<SelfDescribingJson> = [];
        for (let context of globalPrimitives) {
            let generatedContext = generateContext(context, event, eventType, eventSchema);
            if (generatedContext) {
                contexts = contexts.concat(generatedContext);
            }
        }

        for (let provider of conditionalProviders) {
            if (isFilterContextProvider(provider)) {
                let filter : ContextFilter = (provider as FilterContextProvider)[0];
                if (filter(event, eventType, eventSchema)) {
                    let generatedContext = generateContext((provider as FilterContextProvider)[1], event, eventType, eventSchema);
                    if (generatedContext) {
                        contexts = contexts.concat(generatedContext);
                    }
                }
            } else if (isPathContextProvider(provider)) {
                if (matchSchemaAgainstRuleSet((provider as PathContextProvider)[0], eventSchema)) {
                    let generatedContext = generateContext((provider as PathContextProvider)[1], event, eventType, eventSchema)
                    if (generatedContext) {
                        contexts = contexts.concat(generatedContext);
                    }
                }
            }
        }
        return contexts;
    }

    return {
        addGlobalContexts: function (contexts: Array<any>) {
            let acceptedConditionalContexts : ConditionalContextProvider[] = [];
            let acceptedContextPrimitives : ContextPrimitive[] = [];
            for (let context of contexts) {
                if (isContextPrimitive(context)) {
                    acceptedContextPrimitives.concat(context);
                } else if (isConditionalContextProvider(context)) {
                    acceptedConditionalContexts.concat(context);
                } else {
                    // error message here?
                }
            }
            globalPrimitives = globalPrimitives.concat(acceptedContextPrimitives);
            conditionalProviders = conditionalProviders.concat(acceptedConditionalContexts);
        },

        clearAllContexts: function () {
            conditionalProviders = [];
            globalPrimitives = [];
        },

        removeGlobalContexts: function (contexts: Array<any>) {
            for (let context of contexts) {
                if (isContextPrimitive(context)) {
                    globalPrimitives = globalPrimitives.filter(item => !isEqual(item, context));
                } else if (isConditionalContextProvider(context)) {
                    conditionalProviders = conditionalProviders.filter(item => !isEqual(item, context));
                } else {
                    // error message here?
                }
            }
        },

        getApplicableContexts: function (event: PayloadData) : Array<SelfDescribingJson> {
            const builtEvent = event.build();
            if (isSelfDescribingJson(builtEvent)) {
                const decodedEvent = getDecodedEvent(builtEvent as SelfDescribingJson);
                return assembleAllContexts(decodedEvent);
            } else {
                return [];
            }
        }
    };
}