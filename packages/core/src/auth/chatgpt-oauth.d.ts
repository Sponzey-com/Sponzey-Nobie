export interface ChatGptOAuthMetadata {
    enabled: boolean;
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    metadataUrl: string;
    publicBaseUrl: string;
    clientId: string;
    scope: string;
    redirectUriTemplates: string[];
}
export declare function buildChatGptOAuthMetadata(): ChatGptOAuthMetadata;
export declare function isChatGptOAuthEnabled(): boolean;
export declare function validateChatGptRedirectUri(redirectUri: string): boolean;
export declare function createChatGptAuthorizationCode(params: {
    clientId: string;
    redirectUri: string;
    requestedScope?: string;
}): {
    code: string;
    scope: string;
    expiresIn: number;
};
export declare function exchangeChatGptAuthorizationCode(params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}): {
    access_token: string;
    token_type: "bearer";
    expires_in: number;
    refresh_token: string;
    scope: string;
};
export declare function refreshChatGptAccessToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
}): {
    access_token: string;
    token_type: "bearer";
    expires_in: number;
    refresh_token: string;
    scope: string;
};
export declare function validateChatGptAccessToken(accessToken: string): boolean;
//# sourceMappingURL=chatgpt-oauth.d.ts.map