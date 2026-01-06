import type { FewShot } from "./fewshot";

export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, {
            type: string;
            description?: string;
        }>;
        required?: string[];
    };
    few_shot_examples: FewShot[];
    return_parameters: {
        type: string;
        properties: Record<string, {
            type: string;
            description?: string;
        }>;
        required?: string[];
    };
}