/*
 *  Copyright 2018 TWO SIGMA OPEN SOURCE, LLC
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import {Widget} from "@phosphor/widgets";
import BeakerXApi from "./tree/Utils/BeakerXApi";

const widgets = require('./widgets');
const bkUtils = require("./shared/bkUtils");

class SparkUIModel extends widgets.VBoxModel {
  defaults() {
    return {
      ...super.defaults(),
      _view_name: "SparkUIView",
      _model_name: "SparkUIModel",
      _model_module: 'beakerx',
      _view_module: 'beakerx',
      _model_module_version: BEAKERX_MODULE_VERSION,
      _view_module_version: BEAKERX_MODULE_VERSION
    };
  }
}

class SparkUIView extends widgets.VBoxView {
  private sparkStats: Widget;
  private sparkAppId: string;
  private sparkUiWebUrl: string;
  private sparkMasterUrl: string;
  private apiCallIntervalId: number;
  private connectionLabelActive: HTMLElement;
  private connectionLabelMemory: HTMLElement;
  private connectionLabelDead: HTMLElement;
  private connectionStatusElement: HTMLElement;

  initialize(parameters) {
    super.initialize(parameters);

    this.openWebUi = this.openWebUi.bind(this);
    this.openExecutors = this.openExecutors.bind(this);
  }

  public render() {
    super.render();
    this.el.classList.add('widget-spark-ui');

    this.addSparkMetricsWidget();
    this.updateLabels();
  }

  public update() {
    super.update();

    this.connectToApi();
    this.addSparkUrls();
    this.addSparkMetricsWidget();
    this.updateLabels();
  }

  private addSparkUrls() {
    if (!this.connectionStatusElement) {
      this.connectionStatusElement = this.el.querySelector('.bx-connection-status');
    }

    if (!this.connectionStatusElement) {
      return;
    }

    this.addSparUiWebUrl();
    this.addMasterUrl();
  }

  private addSparUiWebUrl() {
    if (this.sparkUiWebUrl) {
      return;
    }

    this.sparkUiWebUrl = this.model.get("sparkUiWebUrl");

    if (!this.sparkUiWebUrl) {
      return;
    }

    this.connectionStatusElement.removeEventListener('click', this.openWebUi);
    this.connectionStatusElement.addEventListener('click', this.openWebUi);
    this.sparkStats.node.removeEventListener('click', this.openExecutors);
    this.sparkStats.node.addEventListener('click', this.openExecutors);
    this.connectionStatusElement.style.cursor = 'pointer';
    this.sparkStats.node.style.cursor = 'pointer';
  }

  private addMasterUrl() {
    if (this.sparkMasterUrl) {
      return
    }

    this.sparkMasterUrl = this.model.get("sparkMasterUrl");

    if (!this.sparkMasterUrl) {
      return;
    }

    this.connectionStatusElement.setAttribute('title', this.sparkMasterUrl);
  }

  private openWebUi() {
    window.open(this.sparkUiWebUrl, '_blank');
  }

  private openExecutors() {
    window.open(`${this.sparkUiWebUrl}/executors`, '_blank');
  }

  private updateLabels() {
    const lengths = [];
    const labels = [];
    const noop = () => {};
    const promise = new Promise((resolve, reject) => {
      this.resolveChildren(this).then((views) => {
        views.forEach((view) => {
          this.resolveChildren(view).then((views) => {
            views.forEach((view) => {
              this.resolveChildren(view)
                .then((views) => {
                  this.collectLabels(views, lengths, labels, resolve);
                })
                .catch(reject);
            });
          }, noop);
        });
      }, noop);
    });

    promise.then(() => {
      const maxWidth = Math.max.apply(null, lengths);

      labels.forEach((label) => { label.style.width = `${maxWidth}px`; });
    }).catch(noop);
  }

  private resolveChildren(view) {
    return new Promise((resolve, reject) => {
      if (!view || !view.children_views) {
        reject();
      }

      view.children_views.update(view.model.get('children'))
        .then(views => resolve(views));
    });
  }

  private collectLabels(views, lengths, labels, resolve) {
    views.forEach((view) => {
      const label = view.el.querySelector('.widget-label');

      if (!label) {
        return true;
      }

      lengths.push(this.getLabelWidth(label));
      labels.push(label);
    });

    resolve();
  }

  private getLabelWidth(labelEl): number {
    labelEl.style.width = 'auto';

    return labelEl.clientWidth;
  }

  private createSparkMetricsWidget(): void {
    this.connectionStatusElement = this.el.querySelector('.bx-connection-status');

    if (this.sparkStats) {
      this.connectionStatusElement.insertAdjacentElement('afterend', this.sparkStats.node);

      return;
    }

    this.sparkStats = new Widget();
    this.sparkStats.node.classList.add('bx-stats');
    this.sparkStats.node.innerHTML = `
      <div class="active label label-info" title="Active Tasks">0</div> <div
      class="dead label label-danger" title="Dead Executors">0</div> <div
      class="memory label label-default" title="Storage Memory">0.0 B</div>
    `;

    this.connectionLabelActive = this.sparkStats.node.querySelector('.active');
    this.connectionLabelMemory = this.sparkStats.node.querySelector('.memory');
    this.connectionLabelDead = this.sparkStats.node.querySelector('.dead');

    this.connectionStatusElement.insertAdjacentElement('afterend', this.sparkStats.node);
  }

  private connectToApi() {
    let baseUrl;
    let api;

    this.sparkAppId = this.model.get('sparkAppId');

    if (!this.sparkAppId) {
      return;
    }

    try {
      const coreutils = require('@jupyterlab/coreutils');
      coreutils.PageConfig.getOption('pageUrl');
      baseUrl = coreutils.PageConfig.getBaseUrl();
    } catch(e) {
      baseUrl = `${window.location.origin}/`;
    }

    api = new BeakerXApi(baseUrl);
    this.setApiCallInterval(api);
  }

  private setApiCallInterval(api: BeakerXApi): void {
    const sparkUrl = `${api.getApiUrl('sparkmetrics/executors')}/${this.sparkAppId}`;
    const getMetrict = async () => {
      try {
        const response = await fetch(sparkUrl, { method: 'GET', credentials: 'include' });

        if (!response.ok) {
          return this.clearApiCallInterval();
        }

        const data = await response.json();
        this.updateMetrics(data);
      } catch(error) {
        this.clearApiCallInterval();
      }
    };

    this.clearApiCallInterval();
    this.apiCallIntervalId = setInterval(getMetrict, 1000);
  }

  private clearApiCallInterval() {
    clearInterval(this.apiCallIntervalId);
    this.sparkAppId = null;
  }

  private updateMetrics(data: Array<any>) {
    let activeTasks: number = 0;
    let deadExecutors: number = 0;
    let storageMemory: number = 0;

    data.forEach(execData => {
      if (execData.isActive) {
        activeTasks += execData.activeTasks;
        storageMemory += execData.memoryUsed;
      } else {
        deadExecutors += 1;
      }
    });

    this.connectionLabelActive.innerText = `${activeTasks}`;
    this.connectionLabelMemory.innerText = `${bkUtils.formatBytes(storageMemory)}`;
    this.connectionLabelDead.innerText = `${deadExecutors}`;
  }

  private addSparkMetricsWidget() {
    this.children_views.update(this.model.get('children')).then((views) => {
      views.forEach((view) => {
        view.children_views.update(view.model.get('children')).then((views) => {
          views.forEach((view) => {
            if (view instanceof widgets.LabelView && view.el.classList.contains('bx-connection-status')) {
              this.createSparkMetricsWidget();
            }
          });
        });
      });
    });
  }

  dispose() {
    super.dispose();
    clearInterval(this.apiCallIntervalId);
  }
}

export default {
  SparkUIModel,
  SparkUIView
};
