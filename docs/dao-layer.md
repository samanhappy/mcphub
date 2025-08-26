# MCPHub DAO Layer 设计文档

## 概述

MCPHub的数据访问对象(DAO)层为项目中`mcp_settings.json`文件中的不同数据类型提供了统一的增删改查操作接口。这个设计使得未来从JSON文件存储切换到数据库存储变得更加容易。

## 架构设计

### 核心组件

```
src/dao/
├── base/
│   ├── BaseDao.ts          # 基础DAO接口和抽象实现
│   └── JsonFileBaseDao.ts  # JSON文件操作的基础类
├── UserDao.ts              # 用户数据访问对象
├── ServerDao.ts            # 服务器配置数据访问对象
├── GroupDao.ts             # 群组数据访问对象
├── SystemConfigDao.ts      # 系统配置数据访问对象
├── UserConfigDao.ts        # 用户配置数据访问对象
├── DaoFactory.ts           # DAO工厂类
├── examples.ts             # 使用示例
└── index.ts               # 统一导出
```

### 数据类型映射

| 数据类型 | 原始位置 | DAO类 | 主要功能 |
|---------|---------|-------|---------|
| IUser | `settings.users[]` | UserDao | 用户管理、密码验证、权限控制 |
| ServerConfig | `settings.mcpServers{}` | ServerDao | 服务器配置、启用/禁用、工具管理 |
| IGroup | `settings.groups[]` | GroupDao | 群组管理、服务器分组、成员管理 |
| SystemConfig | `settings.systemConfig` | SystemConfigDao | 系统级配置、路由设置、安装配置 |
| UserConfig | `settings.userConfigs{}` | UserConfigDao | 用户个人配置 |

## 主要特性

### 1. 统一的CRUD接口

所有DAO都实现了基础的CRUD操作：

```typescript
interface BaseDao<T, K = string> {
  findAll(): Promise<T[]>;
  findById(id: K): Promise<T | null>;
  create(entity: Omit<T, 'id'>): Promise<T>;
  update(id: K, entity: Partial<T>): Promise<T | null>;
  delete(id: K): Promise<boolean>;
  exists(id: K): Promise<boolean>;
  count(): Promise<number>;
}
```

### 2. 特定业务操作

每个DAO还提供了针对其数据类型的特定操作：

#### UserDao 特殊功能
- `createWithHashedPassword()` - 创建用户时自动哈希密码
- `validateCredentials()` - 验证用户凭据
- `updatePassword()` - 更新用户密码
- `findAdmins()` - 查找管理员用户

#### ServerDao 特殊功能
- `findByOwner()` - 按所有者查找服务器
- `findEnabled()` - 查找启用的服务器
- `findByType()` - 按类型查找服务器
- `setEnabled()` - 启用/禁用服务器
- `updateTools()` - 更新服务器工具配置

#### GroupDao 特殊功能
- `findByOwner()` - 按所有者查找群组
- `findByServer()` - 查找包含特定服务器的群组
- `addServerToGroup()` - 向群组添加服务器
- `removeServerFromGroup()` - 从群组移除服务器
- `findByName()` - 按名称查找群组

### 3. 配置管理特殊功能

#### SystemConfigDao
- `getSection()` - 获取特定配置段
- `updateSection()` - 更新特定配置段
- `reset()` - 重置为默认配置

#### UserConfigDao
- `getSection()` - 获取用户特定配置段
- `updateSection()` - 更新用户特定配置段
- `getAll()` - 获取所有用户配置

## 使用方法

### 1. 基本使用

```typescript
import { getUserDao, getServerDao, getGroupDao } from './dao/index.js';

// 用户操作
const userDao = getUserDao();
const newUser = await userDao.createWithHashedPassword('username', 'password', false);
const user = await userDao.findByUsername('username');
const isValid = await userDao.validateCredentials('username', 'password');

// 服务器操作
const serverDao = getServerDao();
const server = await serverDao.create({
  name: 'my-server',
  command: 'node',
  args: ['server.js'],
  enabled: true
});

// 群组操作
const groupDao = getGroupDao();
const group = await groupDao.create({
  name: 'my-group',
  description: 'Test group',
  servers: ['my-server']
});
```

### 2. 配置服务集成

```typescript
import { DaoConfigService, createDaoConfigService } from './config/DaoConfigService.js';

const daoService = createDaoConfigService();

// 加载完整配置
const settings = await daoService.loadSettings();

// 保存配置
await daoService.saveSettings(updatedSettings);
```

### 3. 迁移管理

```typescript
import { migrateToDao, switchToDao, switchToLegacy } from './config/configManager.js';

// 迁移到DAO层
const success = await migrateToDao();

// 运行时切换
switchToDao();      // 切换到DAO层
switchToLegacy();   // 切换回传统方式
```

## 配置选项

可以通过环境变量控制使用哪种数据访问方式：

```bash
# 使用DAO层 (推荐)
USE_DAO_LAYER=true

# 使用传统文件方式 (默认，向后兼容)
USE_DAO_LAYER=false
```

## 未来扩展

### 数据库支持

DAO层的设计使得切换到数据库变得容易，只需要：

1. 实现新的DAO实现类（如DatabaseUserDao）
2. 创建新的DaoFactory
3. 更新配置以使用新的工厂

```typescript
// 未来的数据库实现示例
class DatabaseUserDao implements UserDao {
  constructor(private db: Database) {}
  
  async findAll(): Promise<IUser[]> {
    return this.db.query('SELECT * FROM users');
  }
  
  // ... 其他方法
}
```

### 新数据类型

添加新数据类型只需要：

1. 定义数据接口
2. 创建对应的DAO接口和实现
3. 更新DaoFactory
4. 更新配置服务

## 迁移指南

### 从传统方式迁移到DAO层

1. **备份数据**
```bash
cp mcp_settings.json mcp_settings.json.backup
```

2. **运行迁移**
```typescript
import { performMigration } from './config/migrationUtils.js';
await performMigration();
```

3. **验证迁移**
```typescript
import { validateMigration } from './config/migrationUtils.js';
const isValid = await validateMigration();
```

4. **切换到DAO层**
```bash
export USE_DAO_LAYER=true
```

### 性能对比

可以使用内置工具对比性能：

```typescript
import { performanceComparison } from './config/migrationUtils.js';
await performanceComparison();
```

## 最佳实践

1. **类型安全**: 始终使用TypeScript接口确保类型安全
2. **错误处理**: 在DAO操作周围实现适当的错误处理
3. **事务**: 对于复杂操作，考虑使用事务（未来数据库实现）
4. **缓存**: DAO层包含内置缓存机制
5. **测试**: 使用DAO接口进行单元测试的模拟

## 示例代码

查看以下文件获取完整示例：

- `src/dao/examples.ts` - 基本DAO操作示例
- `src/config/migrationUtils.ts` - 迁移和验证工具
- `src/scripts/dao-demo.ts` - 交互式演示脚本

## 总结

DAO层为MCPHub提供了：

- 🏗️ **模块化设计**: 每种数据类型都有专门的访问层
- 🔄 **易于迁移**: 为未来切换到数据库做好准备
- 🧪 **可测试性**: 接口可以轻松模拟和测试
- 🔒 **类型安全**: 完整的TypeScript类型支持
- ⚡ **性能优化**: 内置缓存和批量操作支持
- 🛡️ **数据完整性**: 强制数据验证和约束

通过引入DAO层，MCPHub的数据管理变得更加结构化、可维护和可扩展。
