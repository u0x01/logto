import fs from 'node:fs/promises';
import path from 'node:path';

import type { MiddlewareType } from 'koa';
import proxy from 'koa-proxies';
import type { IRouterParamContext } from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import serveStatic from '#src/middleware/koa-serve-static.js';
import type Queries from '#src/tenants/Queries.js';

import serveCustomUiAssets from './koa-serve-custom-ui-assets.js';

type Properties = {
  readonly mountedApps: string[];
  readonly queries: Queries;
  readonly packagePath?: string;
  readonly port?: number;
  readonly prefix?: string;
};

export default function koaSpaProxy<StateT, ContextT extends IRouterParamContext, ResponseBodyT>({
  mountedApps,
  packagePath = 'experience',
  port = 5001,
  prefix = '',
  queries,
}: Properties): MiddlewareType<StateT, ContextT, ResponseBodyT> {
  type Middleware = MiddlewareType<StateT, ContextT, ResponseBodyT>;

  const distributionPath = path.join('node_modules/@logto', packagePath, 'dist');

  const spaProxy: Middleware = EnvSet.values.isProduction
    ? serveStatic(distributionPath)
    : proxy('*', {
        target: `http://localhost:${port}`,
        changeOrigin: true,
        logs: true,
        rewrite: (requestPath) => {
          const fullPath = '/' + path.join(prefix, requestPath);
          // Static files
          if (requestPath.includes('.')) {
            return fullPath;
          }

          // In-app routes
          // We'll gradually migrate our single-page apps to use vite, which can directly return the full path
          return packagePath === 'demo-app' ? fullPath : requestPath;
        },
      });

  return async (ctx, next) => {
    const requestPath = ctx.request.path;

    // Skip if the request is for another app
    if (!prefix && mountedApps.some((app) => app !== prefix && requestPath.startsWith(`/${app}`))) {
      return next();
    }

    const { customUiAssets } = await queries.signInExperiences.findDefaultSignInExperience();
    // If user has uploaded custom UI assets, serve them instead of native experience UI
    if (customUiAssets && packagePath === 'experience') {
      const serve = serveCustomUiAssets(customUiAssets.id);
      return serve(ctx, next);
    }

    if (!EnvSet.values.isProduction) {
      return spaProxy(ctx, next);
    }

    const spaDistributionFiles = await fs.readdir(distributionPath);

    if (!spaDistributionFiles.some((file) => requestPath.startsWith('/' + file))) {
      ctx.request.path = '/';
    }

    return spaProxy(ctx, next);
  };
}
