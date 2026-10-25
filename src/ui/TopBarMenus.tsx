import { useState } from 'react';
import type { IndicatorWorkspace } from '../indicators/IndicatorWorkspace';
import { Dropdown } from './Dropdown';
import { IndicatorsMenu } from './IndicatorsMenu';
import { SmaMenu } from './SmaMenu';
import { useWorkspaceSnapshot } from './useWorkspaceSnapshot';

type MenuName = 'indicators' | 'sma';

/** The Indicators and SMA dropdowns. Only one can be open at a time; opening one never changes what is shown. */
export function TopBarMenus({ workspace }: { workspace: IndicatorWorkspace | null }) {
  const snapshot = useWorkspaceSnapshot(workspace);
  const [open, setOpen] = useState<MenuName | null>(null);
  if (workspace === null) return null;

  const onOpenChange = (name: MenuName) => (isOpen: boolean) =>
    setOpen((current) => (isOpen ? name : current === name ? null : current));

  return (
    <>
      <Dropdown id="menu-indicators" label="Indicators" open={open === 'indicators'} onOpenChange={onOpenChange('indicators')}>
        <IndicatorsMenu workspace={workspace} rows={snapshot.indicators} />
      </Dropdown>
      <Dropdown id="menu-sma" label="SMA" open={open === 'sma'} onOpenChange={onOpenChange('sma')}>
        <SmaMenu workspace={workspace} rows={snapshot.smas} />
      </Dropdown>
    </>
  );
}
