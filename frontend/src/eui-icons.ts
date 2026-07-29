// @ts-nocheck
/**
 * Pre-register the EUI icons the app uses.
 *
 * EUI lazy-loads icon SVGs via dynamic import. In this Vite build those imports
 * never resolve, so every `iconType` renders as a blank loading square. Feeding
 * the icon components into EUI's cache up front makes them render synchronously.
 */
import { appendIconComponentCache } from '@elastic/eui/es/components/icon/icon';

import { icon as logoGithub } from '@elastic/eui/es/components/icon/assets/logo_github';
import { icon as alert } from '@elastic/eui/es/components/icon/assets/alert';
import { icon as checkInCircleFilled } from '@elastic/eui/es/components/icon/assets/checkInCircleFilled';
import { icon as playFilled } from '@elastic/eui/es/components/icon/assets/playFilled';
import { icon as search } from '@elastic/eui/es/components/icon/assets/search';
import { icon as link } from '@elastic/eui/es/components/icon/assets/link';
import { icon as check } from '@elastic/eui/es/components/icon/assets/check';
import { icon as refresh } from '@elastic/eui/es/components/icon/assets/refresh';
import { icon as plusInCircle } from '@elastic/eui/es/components/icon/assets/plus_in_circle';
import { icon as save } from '@elastic/eui/es/components/icon/assets/save';
import { icon as sortRight } from '@elastic/eui/es/components/icon/assets/sortRight';
import { icon as document } from '@elastic/eui/es/components/icon/assets/document';
import { icon as merge } from '@elastic/eui/es/components/icon/assets/merge';

// EUI components (Select, ComboBox, CallOut, Accordion, clearable fields, …)
// reach for these internally — register them too so nothing shows blank.
import { icon as arrowDown } from '@elastic/eui/es/components/icon/assets/arrow_down';
import { icon as arrowUp } from '@elastic/eui/es/components/icon/assets/arrow_up';
import { icon as arrowLeft } from '@elastic/eui/es/components/icon/assets/arrow_left';
import { icon as arrowRight } from '@elastic/eui/es/components/icon/assets/arrow_right';
import { icon as cross } from '@elastic/eui/es/components/icon/assets/cross';
import { icon as crossInCircle } from '@elastic/eui/es/components/icon/assets/cross_in_circle';
import { icon as warning } from '@elastic/eui/es/components/icon/assets/warning';
import { icon as empty } from '@elastic/eui/es/components/icon/assets/empty';
import { icon as dot } from '@elastic/eui/es/components/icon/assets/dot';
import { icon as sortable } from '@elastic/eui/es/components/icon/assets/sortable';
import { icon as questionInCircle } from '@elastic/eui/es/components/icon/assets/question_in_circle';
import { icon as image } from '@elastic/eui/es/components/icon/assets/image';

appendIconComponentCache({
  logoGithub,
  alert,
  checkInCircleFilled,
  playFilled,
  search,
  link,
  check,
  refresh,
  plusInCircle,
  save,
  sortRight,
  document,
  merge,
  arrowDown,
  arrowUp,
  arrowLeft,
  arrowRight,
  cross,
  crossInCircle,
  warning,
  empty,
  dot,
  sortable,
  questionInCircle,
  image,
});
