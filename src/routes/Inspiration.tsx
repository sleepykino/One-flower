/**
 * 灵感库页（P2.1-B）：侧边栏进入的独立路由
 * - 今日灵感区块（顶部入口条常驻，点击展开，不自动弹出）
 * - 种子生成器（内嵌本页）
 * - 灵感库列表（类型 / 收藏 / 关键词过滤）
 */

import { HomeSidebar } from '../components/home/HomeSidebar';
import { DailyCardSection } from '../components/inspiration/DailyCardSection';
import { StorySeedGenerator } from '../components/inspiration/StorySeedGenerator';
import { InspirationLibrary } from '../components/inspiration/InspirationLibrary';
import { TourHintButton } from '../components/onboarding/TourHintButton';

export function Inspiration(): JSX.Element {
  return (
    <div className="flex h-full">
      <HomeSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <main className="mx-auto max-w-4xl space-y-4 px-6 py-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="mb-1 text-2xl font-bold">灵感库</h1>
              <p className="text-sm text-ink-500">
                故事种子、每日灵感、角色采访与剧情推演 -- 激发灵感而非替代创作
              </p>
            </div>
            <TourHintButton tourId="inspiration" className="mt-2" />
          </div>
          {/* P7.1：M4 灵感库引导锚点（包裹层仅承载 data-tour，不改各区块布局） */}
          <div data-tour="inspiration-daily">
            <DailyCardSection />
          </div>
          <div data-tour="inspiration-seed">
            <StorySeedGenerator />
          </div>
          <div data-tour="inspiration-library">
            <InspirationLibrary />
          </div>
        </main>
      </div>
    </div>
  );
}
