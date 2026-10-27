import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthUser } from './auth-user';
import { companyStore } from './company-context';
import { scopeOf } from './prisma.service';

/**
 * Runs the handler (and everything it awaits) inside the caller's company context, so settings lookups and
 * PrismaService.runCurrent know which company and branch scope the request acts for. Interceptors run after the
 * guards, so req.user is already the verified caller; public routes (no user) run without a company.
 */
@Injectable()
export class CompanyContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return next.handle();
    const store = { companyId: user.companyId, isSuper: user.isSuper, scope: scopeOf(user) };
    // the handler is invoked on subscribe, so subscribing inside run() keeps the store for its whole async chain
    return new Observable((subscriber) => companyStore.run(store, () => next.handle().subscribe(subscriber)));
  }
}
