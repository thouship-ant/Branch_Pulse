import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { can, Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { BranchReportService } from './branch-report.service';
import { AssignManagerDto, CreateLocationDto, LocationsService, UpdateLocationDto } from './locations.service';
import { ApprovalLimitDto, CategoryDto, MasterService, SettingValueDto, UpdateCategoryDto } from './master.service';
import { CreateRoleDto, RolePermissionsDto, RolesService, UpdateRoleDto } from './roles.service';
import { CreateUserDto, UpdateUserDto, UsersService } from './users.service';

@Controller('locations')
export class LocationsController {
  constructor(
    private readonly svc: LocationsService,
    private readonly reports: BranchReportService,
  ) {}

  @Get() @RequirePermissions('location:view')
  list(@Ctx() ctx: ReqCtx, @Query('type') type?: string) {
    return this.svc.list(ctx, type);
  }

  // literal route must precede ":id"
  @Get('next-code') @RequirePermissions('location:manage')
  nextCode(@Ctx() ctx: ReqCtx, @Query('type') type = 'BRANCH') {
    return this.svc.nextCode(ctx, type);
  }

  @Get('transliterate') @RequirePermissions('location:manage')
  transliterate(@Query('text') text = '') {
    return this.svc.transliterate(text);
  }

  @Get(':id') @RequirePermissions('location:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/history') @RequirePermissions('location:view')
  history(
    @Ctx() ctx: ReqCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.svc.history(ctx, id, { limit: limit ? Number(limit) : undefined, before, entityType });
  }

  @Get(':id/report') @RequirePermissions('report:view')
  report(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.report(ctx, id, from, to);
  }

  @Post(':id/manager') @HttpCode(200) @RequirePermissions('location:manage')
  assignManager(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignManagerDto) {
    return this.svc.assignManager(ctx, id, dto.userId);
  }

  @Post() @RequirePermissions('location:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateLocationDto) {
    return this.svc.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('location:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/activate') @HttpCode(200) @RequirePermissions('location:manage')
  activate(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setActive(ctx, id, true);
  }

  @Post(':id/deactivate') @HttpCode(200) @RequirePermissions('location:manage')
  deactivate(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setActive(ctx, id, false);
  }
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get() @RequirePermissions('user:manage')
  list() {
    return this.users.list();
  }

  @Post() @RequirePermissions('user:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('user:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @Post(':id/sessions/revoke') @HttpCode(200) @RequirePermissions('user:manage')
  revoke(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeUserSessions(id, ctx);
  }
}

@Controller()
export class RolesController {
  constructor(private readonly svc: RolesService) {}

  @Get('roles') @RequirePermissions('role:manage')
  list() {
    return this.svc.listRoles();
  }

  @Get('permissions') @RequirePermissions('role:manage')
  perms() {
    return this.svc.listPermissions();
  }

  @Post('roles') @RequirePermissions('role:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateRoleDto) {
    return this.svc.createRole(ctx, dto);
  }

  @Patch('roles/:id') @RequirePermissions('role:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.svc.updateRole(ctx, id, dto);
  }

  @Put('roles/:id/permissions') @RequirePermissions('role:manage')
  putPerms(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RolePermissionsDto) {
    return this.svc.putRolePermissions(ctx, id, dto);
  }
}

@Controller()
export class MasterController {
  constructor(private readonly master: MasterService) {}

  // any authenticated user may read categories (entry screens need them)
  // inactive ones are listed only for people who manage the configuration
  @Get('expense-categories')
  categories(@Ctx() ctx: ReqCtx, @Query('includeInactive') includeInactive?: string) {
    return this.master.listCategories(includeInactive === 'true' && can(ctx.user, 'settings:manage'));
  }

  @Post('expense-categories') @RequirePermissions('settings:manage')
  createCategory(@Ctx() ctx: ReqCtx, @Body() dto: CategoryDto) {
    return this.master.createCategory(ctx, dto);
  }

  @Patch('expense-categories/:id') @RequirePermissions('settings:manage')
  updateCategory(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.master.updateCategory(ctx, id, dto);
  }

  @Get('settings') @RequirePermissions('settings:manage')
  settings() {
    return this.master.allSettings();
  }

  @Put('settings/:key') @RequirePermissions('settings:manage')
  putSetting(@Ctx() ctx: ReqCtx, @Param('key') key: string, @Body() dto: SettingValueDto) {
    return this.master.putSetting(ctx, key, dto.value);
  }

  @Get('approval-limits') @RequirePermissions('settings:manage')
  limits() {
    return this.master.listLimits();
  }

  @Put('approval-limits') @RequirePermissions('settings:manage')
  putLimit(@Ctx() ctx: ReqCtx, @Body() dto: ApprovalLimitDto) {
    return this.master.putLimit(ctx, dto);
  }
}
