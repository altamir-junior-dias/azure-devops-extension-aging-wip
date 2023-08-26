(() => {
    /* PUBLIC */
    window.WidgetConfiguration = {
        init: (WidgetHelpers) => {
            widgetHelpers = WidgetHelpers;
        },

        load: (widgetSettings, widgetConfigurationContext) => {
            context = widgetConfigurationContext;

            var settings = getSettings(widgetSettings);
            prepareControls(settings);

            return widgetHelpers.WidgetStatusHelper.Success();
        },

        save: (widgetSettings) => {
            return widgetHelpers.WidgetConfigurationSave.Valid(getSettingsToSave(true));
        }
    };

    /* PRIVATE */
    var context;
    var widgetHelpers;

    var $title = $('#title');
    var $team = $('#team');
    var $backlog = $('#backlog');
    var $createdAfter = $('#created-after');
    var $redPercentile = $('#red-percentile');
    var $orangePercentile = $('#orange-percentile');
    var $yellowPercentile = $('#yellow-percentile');
    var $lightGreenPercentile = $('#light-green-percentile');

    var changeSettings = () => {
        settings = getSettingsToSave(false);

        var eventName = widgetHelpers.WidgetEvent.ConfigurationChange;
        var eventArgs = widgetHelpers.WidgetEvent.Args(settings);
        context.notify(eventName, eventArgs);
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
            lightGreenPercentile: settings?.lightGreenPercentile ?? 50
        };
    };

    var getSettingsToSave = (update) => {
        return {
            data: JSON.stringify({
                title: $title.val(),
                team: $team.val(),
                backlogId: $backlog.val(),
                backlogName: $('#backlog option:selected').text(),
                createdAfter: $createdAfter.val(),
                redPercentile: $redPercentile.val(),
                orangePercentile: $orangePercentile.val(),
                yellowPercentile: $yellowPercentile.val(),
                lightGreenPercentile: $lightGreenPercentile.val(),
                update: update
            })
        };
    };

    var prepareControls = (settings) => {
        window.AzureDevOpsProxy.getTeams().then(teams => {
            teams.forEach(team => {
                $team.append($('<option>')
                    .val(team.id)
                    .html(team.name));
            });

            $title.on('change', changeSettings);
            $team.on('change', () => {
                updateBacklogs().then(_ => {
                    changeSettings();
                });
            });
            $backlog.on('change', changeSettings);
            $createdAfter.datepicker({ maxDate: 0 });
            $createdAfter.on('change', changeSettings);
            $redPercentile.on('change', changeSettings);
            $orangePercentile.on('change', changeSettings);
            $yellowPercentile.on('change', changeSettings);
            $lightGreenPercentile.on('change', changeSettings);

            $title.val(settings.title);
            $team.val(settings.team);
            updateBacklogs().then(_ => { $backlog.val(settings.backlogId); });
            if (settings.createdAfter != '') {
                $createdAfter.datepicker('setDate', new Date(settings.createdAfter));
            }
            $redPercentile.val(settings.redPercentile);
            $orangePercentile.val(settings.orangePercentile);
            $yellowPercentile.val(settings.yellowPercentile);
            $lightGreenPercentile.val(settings.lightGreenPercentile);
        });
    };

    var updateBacklogs = () => {
        var deferred = $.Deferred();

        var teamId = $team.val();

        window.AzureDevOpsProxy.getBacklogs(teamId).then(backlogs => {
            $backlog.html('');

            backlogs.forEach(backlog => {
                $backlog.append($('<option>')
                    .val(backlog.id)
                    .html(backlog.name));
            });

            deferred.resolve();
        });

        return deferred.promise();
    }
})();