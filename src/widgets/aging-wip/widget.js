(() => {
    /* PUBLIC */

    window.Widget = {
        load: (widgetSettings) => {
            var settings = getSettings(widgetSettings); 

            if (settings.update) {
                $('#title').text(settings.title);

                $('#chart').hide();
                $message.show();

                getBacklog(settings).then(data => {
                    var percentiles = [
                        0,
                        isNaN(parseInt(settings.lightGreenPercentile, 10)) ? 0 : parseInt(settings.lightGreenPercentile, 10),
                        isNaN(parseInt(settings.yellowPercentile, 10)) ? 0 : parseInt(settings.yellowPercentile, 10),
                        isNaN(parseInt(settings.orangePercentile, 10)) ? 0 : parseInt(settings.orangePercentile, 10),
                        isNaN(parseInt(settings.redPercentile, 10)) ? 0 : parseInt(settings.redPercentile, 10)
                    ];

                    prepareChart(data, percentiles);
                });
            }

            return window.WidgetHelpers.WidgetStatusHelper.Success();
        }
    };

    /* PRIVATE */
    var $message = $('.message');
    var minDot = 3;

    var calculatePercentile = (items, percentile) => {
        if (items.length == 0) {
            return 0;
        }

        items.sort((a, b) => a > b ? 1 : a < b ? -1 : 0);

        var groups = items.reduce((a, c) => (a[c] = (a[c] || 0) + 1, a), Object.create(null));
        var min = Math.min(...items);
        var max = Math.max(...items);

        var database = [];
        for (var index = min; index <= max; index++) {
            database.push({ age: index, items: groups[index] ?? 0 });
        }

        var total = database.reduce((a, b) => a + b.items, 0);
        var ranking = Math.floor((percentile / 100) * total, 0);

        var index = 0;
        var total = 0;

        while (index < database.length)
        {
            total += database[index].items;

            if (total >= ranking)
            {
                break;
            }

            index++;
        }

        return database[index].age;
    };

    var defineColumnLabels = (backlog) => {
        var bottomLabels = backlog.columns.map(column => column.name);

        var lastColumnName = backlog.columns[backlog.columns.length - 1].name;
        var topLabels = backlog.columns.map(column => {
            if (column.name == lastColumnName) {
                return '';
            } else {
                var wip = column.items.length;
                return `WIP: ${wip}`;
            }
        });

        return {
            bottom: bottomLabels,
            top: topLabels
        }
    };

    var getAge = (item, endDate) => {
        endDate = endDate || new Date();
        var startDate = new Date(item['System.CreatedDate']);

        var age = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
        var addDay = age - Math.floor(age) > 0 ? 1 : 0;

        return Math.floor(age) + addDay;
    };

    var getBacklog = (settings) => {
        var deferred = $.Deferred();

        $message.text('Loading backlog configuration');

        window.AzureDevOpsProxy.getBacklogs(settings.team).then(backlogs => {
            var backlogName = backlogs.filter(b => b.id == settings.backlogId)[0].name;

            $('#sub-title').text(settings.createdAfter == '' ? `All items from ${backlogName}` : `Items created after ${new Date(settings.createdAfter).toLocaleDateString()} from ${backlogName}`);
            
            var deferreds = [];
            deferreds.push(window.AzureDevOpsProxy.getBacklog(settings.team, settings.backlogId, backlogName));
            deferreds.push(window.AzureDevOpsProxy.getTeam(settings.team));
            deferreds.push(window.AzureDevOpsProxy.getExtensionData('aging-wip-cache', []));

            Promise.all(deferreds).then(result => {
                var backlog = result[0];
                var team = result[1];
                backlog.cache = result[2];

                getBacklogColumnItems(team.projectName, backlog, settings.createdAfter).then(backlog => {
                    getBacklogItemsChanges(backlog).then(backlog => {
                        deferred.resolve(backlog);
                    });
                });
            });
        });

        return deferred.promise();
    };

    var getBacklogColumnItems = (projectName, backlog, createdAfter, columnNames) => {
        var deferred = $.Deferred();

        if (columnNames === undefined)
        {
            var columns = backlog.columns.map(column => column.name);

            getBacklogColumnItems(projectName, backlog, createdAfter, columns).then(backlog => {
                deferred.resolve(backlog);
            });
        } else {
            var workItemTypes = backlog.workItemTypes.map(workItemType => workItemType.name);
            var columnName = columnNames.shift();
    
            $message.html(`Loading items from <strong>${columnName}</strong> column`);
    
            var query = {
                wiql: 'SELECT [System.Id], [System.Title], [System.BoardColumn], [System.WorkItemType], [System.CreatedDate], [System.ChangedDate], [Microsoft.VSTS.Common.ClosedDate] ' + 
                    'FROM WorkItems ' + 
                    'WHERE [System.TeamProject] = \'' + projectName + '\'' +
                    '  AND [System.BoardColumn] = \'' + columnName + '\'' +
                    '  AND [System.WorkItemType] in (' + workItemTypes.map(workItemType => "'" + workItemType + "'").join(',') + ')' +
                    '  AND [System.BoardColumn] <> \'\'' +
                    (createdAfter == '' ? '' : '  AND [System.CreatedDate] >= \'' + new Date(createdAfter).toISOString().split('T')[0] + '\''),
                type: '1'
            };
    
            window.AzureDevOpsProxy.getItemsFromQuery(query).then(items => {
                backlog.columns.find(column => column.name == columnName).items = items;
    
                if (columnNames.length == 0) {
                    deferred.resolve(backlog);
                } else {
                    getBacklogColumnItems(projectName, backlog, createdAfter, columnNames).then(backlog => {
                        deferred.resolve(backlog);
                    });
                }
            });
        }

        return deferred.promise();
    };

    var getBacklogItemsChanges = (backlog, columns) => {
        var deferred = $.Deferred();

        if (columns === undefined) {

            var columns = backlog.columns.map(column => column.name);
            columns.shift();

            getBacklogItemsChanges(backlog, columns).then(backlog => {
                deferred.resolve(backlog);
            });
        } else {
            var columnName = columns.shift();
            var column = backlog.columns.find(column => column.name == columnName);
            var ids = column.items.map(item => item.id);

            getBacklogItemColumnChanges(backlog, columnName, ids).then(backlog => {
                if (columns.length > 0) {
                    getBacklogItemsChanges(backlog, columns).then(backlog => {
                        deferred.resolve(backlog);
                    });
                } else {
                    deferred.resolve(backlog);
                }
            });
        }

        return deferred.promise();
    };

    var getBacklogItemColumnChangesFromCache = (backlog, columnName, id, item) => {
        var deferred = $.Deferred();
        var changedDate = new Date(item['System.ChangedDate']);

        var index = backlog.cache.findIndex(cache => cache.id == id);

        if (index == -1 || backlog.cache[index].changedDate < changedDate) {
            getBacklogItemColumnChangesFromRevisions(backlog, columnName, id).then(backlog => {
                var column = backlog.columns.find(column => column.name == columnName);
                var item = column.items.find(item => item.id == id);

                var cacheData = {
                    id: id,
                    changedDate: changedDate,
                    boardColumnChanges: item.boardColumnChanges
                }

                if (index == -1)
                {
                    backlog.cache.push(cacheData);
                } else {
                    backlog.cache[index] = cacheData
                }

                deferred.resolve(backlog);
            });

        } else {
            var column = backlog.columns.find(column => column.name == columnName);
            var item = column.items.find(item => item.id == id);        

            item.boardColumnChanges = backlog.cache[index].boardColumnChanges;

            deferred.resolve(backlog);
        }       

        return deferred;
    };

    var getBacklogItemColumnChangesFromRevisions = (backlog, columnName, id) => {
        var deferred = $.Deferred();

        var columnIndex = backlog.columns.findIndex(column => column.name == columnName);
        var column = backlog.columns[columnIndex];
        var item = column.items.find(item => item.id == id);
        var previousColumns = backlog.columns.slice(0, columnIndex).map(c => c.name);

        item.boardColumnChanges = [];

        window.AzureDevOpsProxy.getItemRevisions(id).then(revisions => {
            revisions.sort((a, b) => a.rev > b.rev ? -1 : a.rev < b.rev ? 1 : 0);

            previousColumns.forEach(previousColumn => {
                var index = revisions.findIndex(revision => revision.fields['System.BoardColumn'] == previousColumn);

                if (index > -1)
                {
                    item.boardColumnChanges.push({
                        columnName: previousColumn,
                        age: getAge(item, new Date(revisions[index - 1].fields['System.ChangedDate']))
                    });
                }
            });

            deferred.resolve(backlog);
        });

        return deferred.promise();
    };

    var getBacklogItemColumnChanges = (backlog, columnName, ids) => {
        var deferred = $.Deferred();

        if (ids.length > 0) {
            var id = ids.shift();
            var column = backlog.columns.find(column => column.name == columnName);
            var item = column.items.find(item => item.id == id);
            var progress = Math.round((column.items.length - ids.length) * 100 / column.items.length);

            $message.html(`Loading items revision from <strong>${columnName}</strong> column: <strong>${progress} %</strong>`);

            getBacklogItemColumnChangesFromCache(backlog, columnName, id, item).then(backlog => {
                if (ids.length > 0) {
                    getBacklogItemColumnChanges(backlog, columnName, ids).then(backlog => {
                        deferred.resolve(backlog);
                    });
                } else {
                    window.AzureDevOpsProxy.saveExtensionData('aging-wip-cache', backlog.cache);
                    deferred.resolve(backlog);
                }
            });
        } else {
            deferred.resolve(backlog);
        }

        return deferred.promise();
    };

    var getGreenPercentile = (percentiles) => {
        return percentiles.filter(p => p != 0)[0];
    };

    var getLightGreenPercentile = (percentiles) => {
        var percentile = percentiles[1] != 0;
        var nextPercentiles = percentiles.filter((p, index) => index > 1 && p != 0);

        return percentile != 0 && nextPercentiles.length > 0 ? nextPercentiles[0] : 0;
    };

    var getOrangePercentile = (percentiles) => {
        var percentile = percentiles[3] != 0;
        var nextPercentiles = percentiles.filter((p, index) => index > 3 && p != 0);

        return percentile != 0 && nextPercentiles.length > 0 ? nextPercentiles[0] : 0;
    };

    var getSettings = (widgetSettings) => {
        var settings = JSON.parse(widgetSettings.customSettings.data);

        return {
            title: settings?.title ?? 'Aging WIP',
            team: settings?.team ?? VSS.getWebContext().team.id,
            backlogId: settings?.backlogId ?? 'Microsoft.RequirementCategory',
            backlogName: settings?.backlogName ?? '',
            createdAfter: settings?.createdAfter ?? '',
            redPercentile: settings?.redPercentile ?? 95,
            orangePercentile: settings?.orangePercentile ?? 85,
            yellowPercentile: settings?.yellowPercentile ?? 70,
            lightGreenPercentile: settings?.lightGreenPercentile ?? 50,
            update: true
        };
    };

    var getYellowPercentile = (percentiles) => {
        var percentile = percentiles[2] != 0;
        var nextPercentiles = percentiles.filter((p, index) => index > 2 && p != 0);

        return percentile != 0 && nextPercentiles.length > 0 ? nextPercentiles[0] : 0;
    };

    var prepareBarColumns = (backlog, percentiles, maxValue) => {
        var hasPercentiles = percentiles.filter(p => p != 0).length > 0;

        if (hasPercentiles) {
            percentiles = [
                getGreenPercentile(percentiles),
                getLightGreenPercentile(percentiles),
                getYellowPercentile(percentiles),
                getOrangePercentile(percentiles),
                100
            ];
        }

        var barColumns = [];

        percentiles.forEach(_ => barColumns.push([]));

        for (var columnCounter = 0; columnCounter < backlog.columns.length - 1; ++columnCounter)
        {
            var ages = backlog.columns
                .filter((_, index) => index > columnCounter)
                .map(column => column.items.map(item => item.boardColumnChanges.filter(boardColumnChange => boardColumnChange.columnName == backlog.columns[columnCounter].name).map(boardColumnChange => boardColumnChange.age)))
                .flat(2);

            var currentValue = 0
            for (var percentileCounter = 0; percentileCounter < percentiles.length - 1; percentileCounter++)
            {
                if (percentiles[percentileCounter] == 0) {
                    barColumns[percentileCounter].push(0);

                } else {
                    var percentile = calculatePercentile(ages, percentiles[percentileCounter]);
                    barColumns[percentileCounter].push(percentile - currentValue);
                    currentValue = percentile;
                }
            };

            barColumns[percentiles.length - 1].push(maxValue - currentValue);
        }

        return barColumns;
    };

    var prepareChart = (backlog, percentiles) => {
        $('#chart').show();
        $message.hide();

        var chartArea = document.getElementById('chart');
        var chart = new Chart(chartArea, prepareChartConfiguration(backlog, percentiles));
    }; 

    var prepareChartConfiguration = (backlog, percentiles) => {
        var columnLabels = defineColumnLabels(backlog);

        var dots = prepareDots(backlog);
        var maxAge = Math.max(...[].concat.apply([], dots.map(dot => dot.data)).map(data => data.y))
        var maxRadius = Math.max(...[].concat.apply([], dots.map(dot => dot.data)).map(data => data.r))

        var barColumns = prepareBarColumns(backlog, percentiles, maxAge + maxRadius);
        var green = 'rgb(25, 114, 120, 0.5)';
        var lightGreen = 'rgb(206, 237, 219, 0.5)';
        var yellow = 'rgb(236, 212, 68, 0.5)'
        var orange = 'rgb(231, 119, 40, 0.5)'
        var red = 'rgb(195, 60, 84, 0.5)';

        var datasets = dots;
        datasets.push({ type: 'bar', data: barColumns[0], backgroundColor: green });
        datasets.push({ type: 'bar', data: barColumns[1], backgroundColor: lightGreen });
        datasets.push({ type: 'bar', data: barColumns[2], backgroundColor: yellow });
        datasets.push({ type: 'bar', data: barColumns[3], backgroundColor: orange });
        datasets.push({ type: 'bar', data: barColumns[4], backgroundColor: red });
        
        var config = {
            type: 'bar',
            data: {
                datasets: datasets
            },
            options: {
                events: [ 'mousemove', 'mouseout' ],
                barPercentage: 1,
                categoryPercentage: 1,
                responsive: true,
                maintainAspectRatio: false,
                aspectRatio: 3,
                title: { display: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'nearest',
                        callbacks: {
                            title: () => {},
                            label: (context) => {
                                var lines = [];

                                lines.push(`${context.raw.r - minDot} ${context.dataset.workItemType} with ${context.raw.y} days`);
                                if (context.dataset.data[context.dataIndex].items !== undefined) {
                                    context.dataset.data[context.dataIndex].items.forEach(item => lines.push(`${item.id} - ${item['System.Title']}`));
                                }

                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'category',
                        stacked: true,
                        labels: columnLabels.bottom
                    },
                    y: {
                        stacked: true,
                        min: 0,
                        max: maxAge + maxRadius
                    },
                    'top-y-axis': {
                        type: 'category',
                        position: 'top',
                        labels: columnLabels.top
                    }
                }
            }
        };

        return config;
    };

    var prepareDots = (backlog) => {
        var lastColumnName = backlog.columns[backlog.columns.length - 1].name;
        var maxAge = -1;
        var maxRadius = -1;
        var dots = [];       

        backlog.columns.filter(column => column.name != lastColumnName).forEach(column => {
            column.items.forEach(item => {
                var age = getAge(item);
            
                var dotIndex = dots.findIndex(dot => dot.workItemType == item['System.WorkItemType']);

                if (dotIndex == -1) {
                    var backgroundColor = backlog.workItemTypes.find(workItemType => workItemType.name == item['System.WorkItemType']).color;
                    dots.push({ type: 'bubble', data: [], backgroundColor: `#${backgroundColor}`, workItemType: item['System.WorkItemType'] });
                    dotIndex = dots.length - 1;
                }

                var ageIndex = dots[dotIndex].data.findIndex(d => d.x == column.name && d.y == age);

                if (ageIndex == -1) {
                    dots[dotIndex].data.push({ x: column.name, y: age, r: minDot, items: [] });
                    ageIndex = dots[dotIndex].data.length - 1;
                }

                dots[dotIndex].data[ageIndex].r += 1;
                dots[dotIndex].data[ageIndex].items.push(item);

                if (age > maxAge) {
                    maxAge = age;
                }

                if (dots[dotIndex].data[ageIndex].r > maxRadius) {
                    maxRadius = dots[dotIndex].data[ageIndex].r;
                }
            });
        });

        return dots;
    };
})();

Chart.register({
    id: 'hideTooltips',
    beforeDraw: (chartInstance) => {
        var active = chartInstance.tooltip._active || [];

        if (active.length > 0) {
            if (chartInstance.config.data.datasets[active[0].datasetIndex].type != 'bubble') {
                chartInstance.tooltip.opacity = 0;
            }
        }
    }
  });